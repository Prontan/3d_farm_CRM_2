
import { Printer, ProductTemplate, Order, ColorDef } from './types';

export const INITIAL_PRINTERS: Printer[] = [];

export const PRODUCT_TEMPLATES: ProductTemplate[] = [];

export const INITIAL_ORDERS: Order[] = [];

export const LEGACY_COLOR_MAP: Record<string, string> = {
  'Черный': '#1f2937', // gray-800
  'Белый': '#ffffff',
  'Серый': '#9ca3af', // gray-400
  'Синий': '#2563eb', // blue-600
  'Красный': '#dc2626', // red-600
  'Зеленый': '#16a34a', // green-600
  'Желтый': '#eab308', // yellow-500
  'Оранжевый': '#f97316', // orange-500
  'Фиолетовый': '#9333ea', // purple-600
  'Розовый': '#db2777', // pink-600
  'Коричневый': '#78350f', // amber-900
  'Золотой': '#ca8a04', // yellow-600
  'Серебряный': '#cbd5e1', // slate-300
  'Бежевый': '#f5f5dc',
  'Хаки': '#c3b091',
  'Голубой': '#38bdf8',
  'Салатовый': '#a3e635',
  'Бирюзовый': '#2dd4bf',
  'Темно-синий': '#1e3a8a',
  'Бордовый': '#991b1b',
  'Прозрачный': '#e2e8f0', // slate-200
  'Натуральный': '#fffdd0',
};

export const INITIAL_COLOR_DEFS: ColorDef[] = Object.entries(LEGACY_COLOR_MAP).map(([name, hex]) => ({ name, hex }));

// --- Color Visualization Helpers ---

export const resolveColorHex = (name: string, defs: ColorDef[]): string => {
  if (!name) return '#cbd5e1';
  const normalized = name.trim().toLowerCase();
  
  // 1. Try to find in dynamic definitions
  const def = defs.find(d => d.name.trim().toLowerCase() === normalized);
  if (def) return def.hex;

  // 2. Fallback to legacy map (migration support)
  const legacyKey = Object.keys(LEGACY_COLOR_MAP).find(k => k.toLowerCase() === normalized);
  return legacyKey ? LEGACY_COLOR_MAP[legacyKey] : '#cbd5e1'; // Default slate-300
};

// Kept for backward compatibility in imports, but redirects to using a default list if called directly
// WARNING: This is now deprecated in favor of resolveColorHex
export const getColorHex = (name: string): string => {
  return resolveColorHex(name, INITIAL_COLOR_DEFS);
};

export const isLightColor = (hex: string): boolean => {
  if (!hex) return true;
  // Simple heuristic for contrast text
  const h = hex.replace('#', '');
  let r = 0, g = 0, b = 0;
  
  if (h.length === 3) { // Expand shorthand
     r = parseInt(h[0]+h[0], 16);
     g = parseInt(h[1]+h[1], 16);
     b = parseInt(h[2]+h[2], 16);
  } else if (h.length === 6) {
     r = parseInt(h.substring(0, 2), 16);
     g = parseInt(h.substring(2, 4), 16);
     b = parseInt(h.substring(4, 6), 16);
  } else {
    return true; // Fallback
  }
  
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 128; // Threshold for dark text
};

export const getTextColor = (hex: string): string => {
  return isLightColor(hex) ? '#1f2937' : '#ffffff';
};
