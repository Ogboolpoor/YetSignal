/*
 * YetSignal node firmware — ESP32-S3 (NFR-06, NFR-12).
 *
 * Captures Wi-Fi Channel State Information and streams it to the local sensing
 * server. Implements:
 *   FR-01  CSI capture at ≥ 20–28 Hz
 *   FR-02  BW20 — 56 complex subcarriers per frame
 *   FR-03  channel hopping across 1 / 6 / 11
 *   FR-04  transport to server over WebSocket (localhost / LAN)
 *   FR-05  local ring-buffer when the link is down
 *   FR-15  discovery: mDNS (_signalsense._tcp) + UDP beacon
 *
 * Build with ESP-IDF v5.x: `idf.py set-target esp32s3 && idf.py build flash monitor`.
 * Configure Wi-Fi + server via `idf.py menuconfig` (see Kconfig.projbuild) or the
 * CONFIG_* defaults below.
 */

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/ringbuf.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include "mdns.h"
#include "lwip/sockets.h"
#include "esp_websocket_client.h"

#define TAG "yetsignal"

#ifndef CONFIG_YS_WIFI_SSID
#define CONFIG_YS_WIFI_SSID "your-ssid"
#define CONFIG_YS_WIFI_PASS "your-pass"
#define CONFIG_YS_SERVER_URI "ws://192.168.1.10:8787/ws/node"
#endif

#define SUBCARRIERS 56          /* FR-02: BW20 */
#define DISCOVERY_UDP_PORT 53217 /* must match server config.discoveryUdpPort */
static const uint8_t HOP_CHANNELS[] = {1, 6, 11}; /* FR-03 */

static esp_websocket_client_handle_t s_ws;
static RingbufHandle_t s_buffer;  /* FR-05: local buffer when offline */
static volatile bool s_connected; /* websocket up? */
static char s_mac[18];
static char s_uri[200];
static uint8_t s_hop_idx;

/* One serialised CSI frame sent to the server. */
typedef struct {
    int64_t ts_us;
    int8_t rssi;
    uint8_t channel;
    int8_t iq[SUBCARRIERS * 2]; /* interleaved Re/Im, BW20 (FR-02) */
} __attribute__((packed)) ys_frame_t;

/* ---- CSI capture (FR-01/02) ------------------------------------------------ */
static void csi_cb(void *ctx, wifi_csi_info_t *info)
{
    if (!info || !info->buf) return;
    ys_frame_t f = {0};
    f.ts_us = esp_timer_get_time();
    f.rssi = info->rx_ctrl.rssi;
    f.channel = info->rx_ctrl.channel;

    /* ESP32-S3 delivers I/Q as interleaved int8; copy the BW20 subcarrier set. */
    int n = info->len < (int)sizeof(f.iq) ? info->len : (int)sizeof(f.iq);
    memcpy(f.iq, info->buf, n);

    /* Enqueue; if the server link is down the ring buffer holds recent frames. */
    if (xRingbufferSend(s_buffer, &f, sizeof(f), 0) != pdTRUE) {
        /* buffer full — drop oldest by receiving then discarding one item */
        size_t sz;
        void *old = xRingbufferReceive(s_buffer, &sz, 0);
        if (old) vRingbufferReturnItem(s_buffer, old);
        xRingbufferSend(s_buffer, &f, sizeof(f), 0);
    }
}

static void start_csi(void)
{
    wifi_csi_config_t csi_cfg = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = true,
        .channel_filter_en = true,
        .manu_scale = false,
    };
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&csi_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(&csi_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));
    ESP_LOGI(TAG, "CSI capture enabled (BW20, %d subcarriers)", SUBCARRIERS);
}

/* ---- channel hopping (FR-03) ----------------------------------------------- */
static void hop_task(void *arg)
{
    for (;;) {
        esp_wifi_set_channel(HOP_CHANNELS[s_hop_idx], WIFI_SECOND_CHAN_NONE);
        s_hop_idx = (s_hop_idx + 1) % (sizeof(HOP_CHANNELS) / sizeof(HOP_CHANNELS[0]));
        vTaskDelay(pdMS_TO_TICKS(120)); /* ~8 Hz hop → keeps each channel sampled */
    }
}

/* ---- transport: drain ring buffer to the server (FR-04/05) ----------------- */
static void uplink_task(void *arg)
{
    for (;;) {
        if (s_connected) {
            size_t sz = 0;
            ys_frame_t *f = (ys_frame_t *)xRingbufferReceive(s_buffer, &sz, pdMS_TO_TICKS(50));
            if (f) {
                esp_websocket_client_send_bin(s_ws, (const char *)f, sz, portMAX_DELAY);
                vRingbufferReturnItem(s_buffer, f);
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(200));
        }
    }
}

static void ws_event(void *handler_args, esp_event_base_t base, int32_t id, void *data)
{
    if (id == WEBSOCKET_EVENT_CONNECTED) {
        s_connected = true;
        ESP_LOGI(TAG, "server connected");
        /* identify this node so the server can map our frames (id also in URL) */
        char hello[160];
        int n = snprintf(hello, sizeof(hello), "{\"id\":\"%s\",\"fw\":\"1.0.0\",\"channel\":%d}",
                         s_mac, HOP_CHANNELS[s_hop_idx]);
        esp_websocket_client_send_text(s_ws, hello, n, portMAX_DELAY);
    } else if (id == WEBSOCKET_EVENT_DISCONNECTED) {
        s_connected = false;
        ESP_LOGW(TAG, "server disconnected — buffering locally (FR-05)");
    }
}

/* ---- discovery: mDNS + UDP beacon (FR-15) ---------------------------------- */
static void announce(void)
{
    mdns_init();
    mdns_hostname_set("yetsignal-node");
    mdns_txt_item_t txt[] = {
        {"id", s_mac}, {"fw", "1.0.0"}, {"ch", "1"},
    };
    mdns_service_add(NULL, "_signalsense", "_tcp", 8787, txt, 3);

    /* one-shot UDP broadcast so a server already running picks us up immediately */
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    int on = 1;
    setsockopt(s, SOL_SOCKET, SO_BROADCAST, &on, sizeof(on));
    char json[160];
    int len = snprintf(json, sizeof(json),
                       "{\"id\":\"%s\",\"name\":\"esp32s3-node\",\"fw\":\"1.0.0\",\"ch\":1}", s_mac);
    struct sockaddr_in dst = {.sin_family = AF_INET, .sin_port = htons(DISCOVERY_UDP_PORT)};
    dst.sin_addr.s_addr = htonl(INADDR_BROADCAST);
    sendto(s, json, len, 0, (struct sockaddr *)&dst, sizeof(dst));
    close(s);
    ESP_LOGI(TAG, "announced via mDNS + UDP as %s", s_mac);
}

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ESP_LOGI(TAG, "got IP — starting CSI, discovery and uplink");
        start_csi();
        announce();
        /* append identity to the URL: ws://host:port/ws/node?id=MAC&ch=1&fw=… */
        snprintf(s_uri, sizeof(s_uri), "%s?id=%s&ch=%d&fw=1.0.0",
                 CONFIG_YS_SERVER_URI, s_mac, HOP_CHANNELS[0]);
        esp_websocket_client_config_t cfg = {.uri = s_uri};
        s_ws = esp_websocket_client_init(&cfg);
        esp_websocket_register_events(s_ws, WEBSOCKET_EVENT_ANY, ws_event, NULL);
        esp_websocket_client_start(s_ws);
        xTaskCreate(hop_task, "hop", 2048, NULL, 4, NULL);
        xTaskCreate(uplink_task, "uplink", 4096, NULL, 5, NULL);
    }
}

void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_mac, sizeof(s_mac), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    s_buffer = xRingbufferCreate(sizeof(ys_frame_t) * 256, RINGBUF_TYPE_NOSPLIT); /* FR-05 */

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t wic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wic));
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_wifi, NULL, NULL);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_wifi, NULL, NULL);

    wifi_config_t wc = {0};
    strncpy((char *)wc.sta.ssid, CONFIG_YS_WIFI_SSID, sizeof(wc.sta.ssid));
    strncpy((char *)wc.sta.password, CONFIG_YS_WIFI_PASS, sizeof(wc.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "YetSignal node booting (MAC %s)", s_mac);
}
