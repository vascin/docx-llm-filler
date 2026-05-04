// ============================================
// Global State & Constants
// ============================================
const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const APP_REVISION = 'r2026.04.26.fix1';
const TWIPS_PER_POINT = 20;
const DPI = 96;
const POINTS_TO_PX = DPI / 72;
const A4_WIDTH_POINTS = 595;
const A4_HEIGHT_POINTS = 842;

let jsonData = { categories: [] };
let mappingData = {};
let hasUnsavedChanges = false;
let hasUnsavedDoc = false;
let zip = null;
let currentFileData = null;
let contentWidth = 0;
let promptTemplate = '';
let providerSecrets = {};

const filledCells = new Set();
