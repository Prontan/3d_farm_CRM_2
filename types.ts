

export enum OrderStatus {
  QUEUED = 'QUEUED', // Waiting to be assigned or printed
  ASSIGNED = 'ASSIGNED', // In progress (some or all plates assigned)
  PRINTED = 'PRINTED', // All plates finished, waiting for check/assembly
  ASSEMBLED = 'ASSEMBLED', // Assembly finished
  PACKED = 'PACKED', // Packed and ready (Legacy)
  SHIPPED = 'SHIPPED', // Sent to client
  STORED = 'STORED', // Sent to warehouse
}

export type DeadlineMode = 'DEFAULT_WORKDAYS' | 'CUSTOM_WORKDAYS' | 'CUSTOM_DATE';

export interface OrderCreateMeta {
  etsyOrderId: string;
  etsyOrderedAt: number; // UTC timestamp, entered in Los Angeles timezone
  deadlineAt: number; // UTC timestamp, fixed to 16:00 Los Angeles
  deadlineMode: DeadlineMode;
  deadlineWorkdays?: number;
}

export interface ColorDef {
  name: string;
  hex: string;
}

export interface FilamentStock {
  color: string;
  type: string; // PLA, PETG
  weightGrams: number;
}

export interface GlobalSettings {
  wastePercentage: number; // Percentage of extra filament used (e.g., 5 for 5%)
}

export interface Printer {
  id: string;
  name: string;
  isMultiColor: boolean;
  supportedColors: string[]; // e.g., ['Red', 'Black', 'White']
  isMaintenance?: boolean;
  orderIndex?: number; // Position in the grid
}

export interface Plate {
  id: string;
  name: string;
  photoUrl: string;
  printTimeMinutes: number;
  filamentType: string; // e.g., "PLA", "PETG", "TPU"
  colors?: string[]; // Specific colors for this plate (optional)
  filamentUsage?: number[]; // Weight in grams. If colors is set, corresponds to indices. If not, index 0 is total.
}

export interface ProductTemplate {
  id: string;
  name: string;
  photoUrl: string; // Main thumbnail for the product
  
  // Aggregates (calculated from plates if plates exist, or manual if not)
  printTimeMinutes: number; 
  
  assemblyTimeMinutes: number;
  packingTimeMinutes: number;
  preferredPrinterIds: string[];
  defaultColors: string[];
  
  // New: Multi-plate support
  plates: Plate[]; 
}

export interface PlateAssignment {
  printerId: string | null;
  status: OrderStatus; // usually QUEUED, ASSIGNED, or PRINTED
  orderIndex?: number; // Position in the printer queue
  batchId?: string | null; // Optional identifier for manual batch grouping
}

export interface Order {
  id: string;
  templateId: string;
  status: OrderStatus;
  // Legacy field support (can be derived, but kept for compatibility logic)
  assignedPrinterId: string | null; 
  
  plateAssignments: Record<string, PlateAssignment>; // Map<plateId, assignment>

  comments: string; // If not empty, highlight strongly
  selectedColors: string[]; // Main colors for the order (used as default or summary)
  
  // New fields for custom coloring
  plateSpecificColors?: Record<string, string[]>; // Map<plateId, colors[]>
  isCustomColor?: boolean; // Flag to indicate unique/custom color configuration

  // Etsy/deadline metadata (optional for legacy records)
  etsyOrderId?: string;
  etsyOrderedAt?: number;
  deadlineAt?: number;
  deadlineMode?: DeadlineMode;
  deadlineWorkdays?: number;
  usesExtendedHours?: boolean;
  needsManualScheduling?: boolean;

  createdAt: number;
  queueIndex: number; // For manual prioritization
}

export interface DragItem {
  type: 'PLATE';
  orderId: string;
  plateId: string;
  fromPrinterId: string | null; 
}

export interface StockItem {
  id: string; // Composite key: templateId + sorted colors string
  templateId: string; // For parts, this effectively acts as the plateId reference or grouping ID
  plateId?: string; // Optional: specifically for parts to link back to global parts or template plates
  type?: 'PRODUCT' | 'PART'; // New field to distinguish finished goods from spare parts
  colors: string[];
  quantity: number;
  
  // New fields for custom items
  isCustom?: boolean;
  plateSpecificColors?: Record<string, string[]>;
}
