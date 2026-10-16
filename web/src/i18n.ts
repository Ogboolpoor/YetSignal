import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// NFR-15 — interface localisation (Ukrainian + English).
const resources = {
  uk: {
    translation: {
      app: { tagline: 'Сенсинг простору через Wi-Fi CSI — без камер і мікрофонів' },
      nav: { dashboard: 'Панель', mesh: '3D-мережа', nodes: 'Вузли', history: 'Історія', settings: 'Налаштування' },
      status: { connected: 'Підключено', disconnected: 'Немає зв’язку', online: 'онлайн', mqtt: 'MQTT' },
      privacy: { on: 'Режим приватності', off: 'Сенсинг активний', banner: 'Режим приватності увімкнено — сенсинг призупинено' },
      presence: { title: 'Присутність', present: 'Присутній', absent: 'Відсутній' },
      people: { title: 'Кількість людей', estimate: 'оцінка' },
      activity: { title: 'Активність', absent: 'немає', still: 'спокій', moving: 'рух', walking: 'ходьба', fall: 'ПАДІННЯ!' },
      vitals: { breathing: 'Дихання', heart: 'Пульс', bpm: 'уд/хв', none: '—' },
      motion: { title: 'Рівень руху' },
      heatmap: { title: 'Теплова карта активності' },
      csi: { title: 'CSI (амплітуда по піднесучих)', waiting: 'очікування даних…' },
      sim: { title: 'Симулятор', people: 'Людей у кімнаті', fall: 'Симулювати падіння', addNode: 'Додати вузол', noNodes: 'Усі вузли видалено — додайте вузол, щоб відновити сенсинг.' },
      nodes: { name: 'Назва', id: 'MAC', status: 'Стан', rssi: 'RSSI', quality: 'Якість', channel: 'Канал', fw: 'Прошивка', temp: 'Темп.', remove: 'Видалити', online: 'онлайн', offline: 'офлайн', sim: 'сим', empty: 'Вузли не знайдено' },
      settings: {
        title: 'Налаштування',
        modes: 'Режими сенсингу',
        presence: 'Присутність', motion: 'Рух / падіння', breathing: 'Дихання', heart: 'Пульс (допоміжний)', pose: 'Поза (потребує кілька вузлів)',
        sensitivity: 'Чутливість присутності', motionThreshold: 'Поріг руху', fallSensitivity: 'Чутливість падіння',
        retention: 'Зберігання даних (днів)', rawCsi: 'Сирий CSI', derived: 'Похідні події', vital: 'Фізіологічні',
        calibrate: 'Калібрувати порожню кімнату', calibrated: 'Базову лінію збережено',
        language: 'Мова',
        retentionHint: '0 = не зберігати. NFR-21: сирі CSI-дані за замовчуванням не зберігаються.',
      },
      history: { title: 'Історія', presence: 'Присутність', people: 'Кількість людей', motion: 'Рух', breathing: 'Дихання', hours: 'Період (год)', empty: 'Немає даних за період' },
      metrics: { title: 'Діагностика', fps: 'Кадрів/с', frameUs: 'Час кадру (мкс)', latency: 'Затримка інференсу (мс)', uptime: 'Аптайм', varMax: 'Дисперсія (присут.)', breathSnr: 'SNR дихання' },
      logs: { title: 'Журнал подій' },
    },
  },
  en: {
    translation: {
      app: { tagline: 'Wi-Fi CSI spatial sensing — no cameras, no microphones' },
      nav: { dashboard: 'Dashboard', mesh: '3D Mesh', nodes: 'Nodes', history: 'History', settings: 'Settings' },
      status: { connected: 'Connected', disconnected: 'Disconnected', online: 'online', mqtt: 'MQTT' },
      privacy: { on: 'Privacy mode', off: 'Sensing active', banner: 'Privacy mode is ON — sensing is suspended' },
      presence: { title: 'Presence', present: 'Present', absent: 'Absent' },
      people: { title: 'People count', estimate: 'estimate' },
      activity: { title: 'Activity', absent: 'none', still: 'still', moving: 'moving', walking: 'walking', fall: 'FALL!' },
      vitals: { breathing: 'Breathing', heart: 'Heart rate', bpm: 'bpm', none: '—' },
      motion: { title: 'Motion level' },
      heatmap: { title: 'Activity heatmap' },
      csi: { title: 'CSI (amplitude per subcarrier)', waiting: 'waiting for data…' },
      sim: { title: 'Simulator', people: 'People in room', fall: 'Simulate fall', addNode: 'Add node', noNodes: 'All nodes removed — add a node to resume sensing.' },
      nodes: { name: 'Name', id: 'MAC', status: 'Status', rssi: 'RSSI', quality: 'Quality', channel: 'Channel', fw: 'Firmware', temp: 'Temp.', remove: 'Remove', online: 'online', offline: 'offline', sim: 'sim', empty: 'No nodes discovered' },
      settings: {
        title: 'Settings',
        modes: 'Sensing modes',
        presence: 'Presence', motion: 'Motion / fall', breathing: 'Breathing', heart: 'Heart rate (auxiliary)', pose: 'Pose (needs several nodes)',
        sensitivity: 'Presence sensitivity', motionThreshold: 'Motion threshold', fallSensitivity: 'Fall sensitivity',
        retention: 'Data retention (days)', rawCsi: 'Raw CSI', derived: 'Derived events', vital: 'Vital signs',
        calibrate: 'Calibrate empty room', calibrated: 'Baseline saved',
        language: 'Language',
        retentionHint: '0 = do not store. NFR-21: raw CSI is not stored by default.',
      },
      history: { title: 'History', presence: 'Presence', people: 'People count', motion: 'Motion', breathing: 'Breathing', hours: 'Window (h)', empty: 'No data for this window' },
      metrics: { title: 'Diagnostics', fps: 'Frames/s', frameUs: 'Frame time (µs)', latency: 'Inference latency (ms)', uptime: 'Uptime', varMax: 'Variance (presence)', breathSnr: 'Breathing SNR' },
      logs: { title: 'Event log' },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'uk',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
