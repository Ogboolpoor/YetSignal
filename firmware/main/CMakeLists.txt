idf_component_register(
    SRCS "yetsignal_node.c"
    INCLUDE_DIRS "."
    REQUIRES esp_wifi esp_event nvs_flash esp_netif mdns esp_websocket_client esp_timer lwip
)
