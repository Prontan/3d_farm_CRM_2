
import React, { useState, useCallback, useEffect } from 'react';
import { 
  PlusCircle, 
  Printer as PrinterIcon, 
  Wrench, 
  Package, 
  LayoutGrid,
  Settings as SettingsIcon,
  Loader2,
  Warehouse,
  LogOut,
  Wifi,
  CloudOff,
  RefreshCw
} from 'lucide-react';
import { Order, OrderStatus, ProductTemplate, Printer, PlateAssignment, StockItem, ColorDef, Plate, FilamentStock, OrderCreateMeta } from './types';
import { PrintingTab } from './components/PrintingTab';
import { AssemblyPackingTab } from './components/AssemblyPackingTab';
import { AddOrderTab } from './components/AddOrderTab';
import { SettingsTab } from './components/SettingsTab';
import { StockTab } from './components/StockTab';
import { LoginScreen } from './components/LoginScreen';
import { db } from './utils/db';
import { LEGACY_COLOR_MAP } from './constants';
import {
  PRINTER_CHANGEOVER_MINUTES,
  PRINTER_DAY_START_HOUR,
  PRINTER_EXTENDED_DAY_MINUTES,
  PRINTER_NORMAL_DAY_MINUTES,
  computePrintDeadline,
  isWorkingDayKey,
  makePlateSignature,
  nextDayKey,
  toDayKeyInLA,
  dayKeyToUtc
} from './utils/deadlines';

type Tab = 'ORDERS' | 'PRINTING' | 'ASSEMBLY' | 'PACKING' | 'STOCK' | 'SETTINGS';

// Helper to sanitize assignments to ensure no circular references or extra props
const sanitizeAssignment = (a?: Partial<PlateAssignment> | null): PlateAssignment => {
  const statusValue = a?.status;
  const isValidStatus = typeof statusValue === 'string' && Object.values(OrderStatus).includes(statusValue as OrderStatus);

  return {
    printerId: a?.printerId || null,
    status: isValidStatus ? (statusValue as OrderStatus) : OrderStatus.QUEUED,
    orderIndex: typeof a?.orderIndex === 'number' ? a.orderIndex : 0,
    batchId: a?.batchId ?? null
  };
};

const sanitizeStringArray = (arr: unknown): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0);
};

const sanitizePlateColorMap = (map: unknown): Record<string, string[]> => {
  if (!map || typeof map !== 'object') return {};
  return Object.entries(map as Record<string, unknown>).reduce((acc, [k, v]) => {
    const key = String(k || '').trim();
    if (!key) return acc;
    const colors = sanitizeStringArray(v);
    if (colors.length > 0) {
      acc[key] = colors;
    }
    return acc;
  }, {} as Record<string, string[]>);
};

// Helper to sanitize Order objects before saving
const sanitizeOrder = (o: Order): Order => {
  const safeStatus = (typeof o.status === 'string' && Object.values(OrderStatus).includes(o.status as OrderStatus))
    ? o.status
    : OrderStatus.QUEUED;
  const safeCreatedAt = (typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)) ? o.createdAt : Date.now();
  const safeQueueIndex = (typeof o.queueIndex === 'number' && Number.isFinite(o.queueIndex)) ? o.queueIndex : safeCreatedAt;
  const safeSelectedColors = sanitizeStringArray(o.selectedColors);
  const safePlateColorMap = sanitizePlateColorMap(o.plateSpecificColors);

  const base: Order = {
    id: String(o.id || ''),
    templateId: String(o.templateId || ''),
    status: safeStatus,
    assignedPrinterId: o.assignedPrinterId || null,
    plateAssignments: Object.entries(o.plateAssignments || {}).reduce((acc, [k, v]) => {
      const key = String(k || '').trim();
      if (!key) return acc;
      acc[key] = sanitizeAssignment(v);
      return acc;
    }, {} as Record<string, PlateAssignment>),
    comments: typeof o.comments === 'string' ? o.comments : '',
    selectedColors: safeSelectedColors,
    plateSpecificColors: safePlateColorMap,
    isCustomColor: !!o.isCustomColor,
    usesExtendedHours: !!o.usesExtendedHours,
    needsManualScheduling: !!o.needsManualScheduling,
    createdAt: safeCreatedAt,
    queueIndex: safeQueueIndex
  };

  const optional: Partial<Order> = {
    ...(typeof o.etsyOrderId === 'string' && o.etsyOrderId.trim() ? { etsyOrderId: o.etsyOrderId.trim() } : {}),
    ...(typeof o.etsyOrderedAt === 'number' && Number.isFinite(o.etsyOrderedAt) ? { etsyOrderedAt: o.etsyOrderedAt } : {}),
    ...(typeof o.deadlineAt === 'number' && Number.isFinite(o.deadlineAt) ? { deadlineAt: o.deadlineAt } : {}),
    ...(o.deadlineMode ? { deadlineMode: o.deadlineMode } : {}),
    ...(typeof o.deadlineWorkdays === 'number' && Number.isFinite(o.deadlineWorkdays)
      ? { deadlineWorkdays: Math.max(1, Math.floor(o.deadlineWorkdays)) }
      : {})
  };

  return { ...base, ...optional };
};

// Duplicated compression helper to perform migration
const compressImage = (base64OrUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    // If it's a short URL (not base64), return as is (skip)
    if (!base64OrUrl.startsWith('data:image')) {
        resolve(base64OrUrl);
        return;
    }

    const img = new Image();
    img.src = base64OrUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 500;
      const MAX_HEIGHT = 500;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else {
          resolve(base64OrUrl); // Fail safe
      }
    };
    img.onerror = () => resolve(base64OrUrl); // Fail safe
  });
};

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(db.isAuthenticated());
  const [activeTab, setActiveTab] = useState<Tab>('ORDERS');
  const [isLoading, setIsLoading] = useState(false);
  
  // New state for blocking UI interactions during async actions
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<string>('');
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [templates, setTemplates] = useState<ProductTemplate[]>([]);
  const [colors, setColors] = useState<ColorDef[]>([]); 
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [globalParts, setGlobalParts] = useState<Plate[]>([]);
  const [filamentStock, setFilamentStock] = useState<FilamentStock[]>([]);
  const [wastePercentage, setWastePercentage] = useState<number>(0);

  // Function to load data from the server
  const loadData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      else setIsSyncing(true);
      
      // If DB is not configured (e.g. wiped localStorage), kick to login
      if (!db.isConfigured()) {
         setIsAuthenticated(false);
         return;
      }

      // OPTIMIZED: Fetch Active Orders + Limited Archive instead of everything
      const [activeOrders, archivedOrders, dbPrinters, dbTemplates, dbColors, dbStock, dbParts, dbFilament, dbSettings] = await Promise.all([
        db.getActiveOrders(),
        db.getArchivedOrders(50), // Limit to last 50 finished items
        db.getPrinters(),
        db.getTemplates(),
        db.getColors(),
        db.getStock(),
        db.getParts(),
        db.getFilamentStock(),
        db.getGlobalSettings()
      ]);
      
      // Merge active and archived for the UI
      const dbOrders = [...activeOrders, ...archivedOrders];
      // Deduplicate if any overlap (rare but possible with quick status changes)
      const uniqueOrders = Array.from(new Map(dbOrders.map(o => [o.id, o])).values());

      setConnectionError(false);

      // Normalize Templates (Legacy support)
      let loadedTemplates = dbTemplates || [];
      loadedTemplates = loadedTemplates.map(t => ({
        ...t,
        plates: (t.plates || []).map((p: any) => ({
          ...p,
          colors: Array.isArray(p.colors) ? p.colors : (p.color ? [p.color] : [])
        }))
      }));

      // Normalize Orders
      let loadedOrders: Order[] = uniqueOrders || [];
      const migratedOrders = loadedOrders.map((order: Order) => {
        const tmpl = loadedTemplates.find(t => t.id === order.templateId);
        if (!tmpl) return order;

        if (!order.plateAssignments || Object.keys(order.plateAssignments).length === 0) {
          const newAssignments: Record<string, PlateAssignment> = {};
          if (tmpl.plates && tmpl.plates.length > 0) {
            tmpl.plates.forEach(p => {
              newAssignments[p.id] = {
                printerId: order.assignedPrinterId || null, 
                status: order.status === OrderStatus.PRINTED ? OrderStatus.PRINTED : (order.assignedPrinterId ? OrderStatus.ASSIGNED : OrderStatus.QUEUED),
                orderIndex: 0
              };
            });
          }
          return { ...order, plateAssignments: newAssignments };
        }
        return order;
      });
      
      const safeOrders = migratedOrders.map((o, index) => ({
        ...o,
        queueIndex: typeof o.queueIndex === 'number' ? o.queueIndex : o.createdAt || index,
        etsyOrderId: o.etsyOrderId?.trim() || undefined,
        usesExtendedHours: !!o.usesExtendedHours,
        needsManualScheduling: !!o.needsManualScheduling
      }));

      setOrders(safeOrders);
      
      // Sort Printers by orderIndex
      const sortedPrinters = (dbPrinters || []).sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
      setPrinters(sortedPrinters);
      
      setTemplates(loadedTemplates);
      setStockItems(dbStock || []);
      setGlobalParts(dbParts || []);
      setFilamentStock(dbFilament || []);
      setWastePercentage(dbSettings.wastePercentage || 0);
      
      // Normalize Colors
      let loadedColors: ColorDef[] = [];
      if (dbColors) {
         if (Array.isArray(dbColors) && dbColors.length > 0) {
           if (typeof dbColors[0] === 'string') {
              const legacyList = dbColors as unknown as string[];
              loadedColors = legacyList.map(name => ({
                 name,
                 hex: LEGACY_COLOR_MAP[name] || '#cbd5e1'
              }));
           } else {
              loadedColors = dbColors as unknown as ColorDef[];
           }
         }
      } else {
         loadedColors = []; 
      }
      setColors(loadedColors);

    } catch (error: any) {
      console.error("Failed to load database:", error);
      setConnectionError(true);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, []);

  // --- Migration Logic ---
  const runImageMigration = useCallback(async () => {
      // Threshold: ~200KB. Base64 is ~1.33x size. 200,000 chars is roughly 150KB image.
      const SIZE_THRESHOLD = 200000; 

      const currentTemplates = await db.getTemplates();
      const currentParts = await db.getParts();
      
      let hasUpdates = false;
      let updateCount = 0;
      setMigrationStatus('Проверка изображений...');

      // 1. Process Templates
      for (const t of currentTemplates) {
          let tModified = false;
          let newPhoto = t.photoUrl;

          // Check Template Photo
          if (t.photoUrl && t.photoUrl.length > SIZE_THRESHOLD) {
             newPhoto = await compressImage(t.photoUrl);
             tModified = true;
          }

          // Check Plates in Template
          let newPlates = t.plates || [];
          if (t.plates) {
              const processedPlates = await Promise.all(t.plates.map(async (p) => {
                  if (p.photoUrl && p.photoUrl.length > SIZE_THRESHOLD) {
                      tModified = true;
                      return { ...p, photoUrl: await compressImage(p.photoUrl) };
                  }
                  return p;
              }));
              newPlates = processedPlates;
          }

          if (tModified) {
              await db.saveTemplate({ ...t, photoUrl: newPhoto, plates: newPlates });
              hasUpdates = true;
              updateCount++;
              setMigrationStatus(`Оптимизация: ${updateCount} объектов...`);
          }
      }

      // 2. Process Global Parts
      for (const p of currentParts) {
          if (p.photoUrl && p.photoUrl.length > SIZE_THRESHOLD) {
              const newPhoto = await compressImage(p.photoUrl);
              await db.savePart({ ...p, photoUrl: newPhoto });
              hasUpdates = true;
              updateCount++;
              setMigrationStatus(`Оптимизация: ${updateCount} объектов...`);
          }
      }

      if (hasUpdates) {
          console.log(`Migration complete. Updated ${updateCount} items.`);
          await loadData(false); // Reload to reflect changes
      }
      setMigrationStatus('');
  }, [loadData]);


  // --- Initial Load Only (No Polling) ---
  useEffect(() => {
    if (isAuthenticated) {
      loadData(true).then(() => {
          // Run migration after initial load
          setTimeout(() => {
             runImageMigration();
          }, 1000);
      });
    }
  }, [isAuthenticated, loadData, runImageMigration]);

  // --- Filament Management Helpers ---
  
  // Modify local filament stock (doesn't save to DB immediately, returns new array)
  const calculateNewStock = (
    currentStock: FilamentStock[], 
    colorName: string, 
    type: string, 
    gramsChange: number // Positive adds, negative subtracts
  ): FilamentStock[] => {
     const idx = currentStock.findIndex(f => f.color === colorName && f.type === type);
     let newStock = [...currentStock];
     
     if (idx >= 0) {
       newStock[idx] = {
         ...newStock[idx],
         weightGrams: newStock[idx].weightGrams + gramsChange
       };
     } else if (gramsChange > 0) {
       // Only create new if adding
       newStock.push({ color: colorName, type, weightGrams: gramsChange });
     }
     // Note: If subtracting from non-existent, we assume 0 start -> negative result (Deficit)
     if (idx === -1 && gramsChange < 0) {
        newStock.push({ color: colorName, type, weightGrams: gramsChange });
     }
     
     return newStock;
  };

  const updateOrderFilament = (
    ordersList: Order[], 
    orderId: string, 
    plateId: string, 
    mode: 'DEDUCT' | 'REFUND',
    currentFilamentStock: FilamentStock[]
  ): FilamentStock[] => {
     const order = ordersList.find(o => o.id === orderId);
     if (!order) return currentFilamentStock;

     const template = templates.find(t => t.id === order.templateId);
     if (!template || !template.plates) return currentFilamentStock;

     const plate = template.plates.find(p => p.id === plateId);
     if (!plate || !plate.filamentUsage || plate.filamentUsage.length === 0) return currentFilamentStock;

     // Determine colors for this plate
     const specificColors = order.plateSpecificColors?.[plate.id];
     const activeColors = (specificColors && specificColors.length > 0) ? specificColors : order.selectedColors;

     // Determine weights (if multiple colors, usage array corresponds to them)
     let updatedStock = [...currentFilamentStock];

     // Calculate Waste Multiplier
     // E.g., waste = 10% -> multiplier = 1.10
     const wasteMultiplier = 1 + (wastePercentage / 100);

     activeColors.forEach((color, index) => {
        let weight = 0;
        if (plate.filamentUsage && plate.filamentUsage.length > index) {
           weight = plate.filamentUsage[index];
        } else if (plate.filamentUsage && plate.filamentUsage.length === 1) {
           weight = plate.filamentUsage[0]; // Fallback for single color logic
        }

        if (weight > 0) {
           // Apply waste percentage
           const finalWeight = weight * wasteMultiplier;
           
           const change = mode === 'DEDUCT' ? -finalWeight : finalWeight;
           updatedStock = calculateNewStock(updatedStock, color, plate.filamentType, change);
        }
     });

     return updatedStock;
  };

  // --- Handlers (Wrap DB calls with isGlobalProcessing) ---
  // OPTIMIZATION: Removed redundant await loadData(false) from most handlers.
  // The app updates local state optimistically. Background sync happens via saveOrder/saveXYZ.

  const handleMovePlate = useCallback(async (orderId: string, plateId: string, targetPrinterId: string | null, targetIndex?: number) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    
    try {
        // 1. Unassignment Logic (Assigned -> Queued)
        if (!targetPrinterId) {
           const order = orders.find(o => o.id === orderId);
           if (order) {
              // Check if it was previously assigned (not just re-queued)
              const prevAssignment = order.plateAssignments[plateId];
              const wasAssigned = prevAssignment && prevAssignment.status !== OrderStatus.QUEUED;

              const newAssignments = { ...order.plateAssignments };
              // FIX: Use null instead of undefined for batchId to satisfy Firebase setDoc
              newAssignments[plateId] = { printerId: null, status: OrderStatus.QUEUED, orderIndex: 0, batchId: null };
              
              // Calculate status
              const allValues: PlateAssignment[] = Object.values(newAssignments);
              const allPrinted = allValues.every(a => a.status === OrderStatus.PRINTED);
              const anyAssigned = allValues.some(a => a.status === OrderStatus.ASSIGNED || a.status === OrderStatus.PRINTED); // Printed counts as active
              const newStatus = allPrinted ? OrderStatus.PRINTED : (anyAssigned ? OrderStatus.ASSIGNED : OrderStatus.QUEUED);
              
              // Correctly determine legacy assignedPrinterId (keep if others are assigned)
              const stillAssigned = allValues.find(a => a.printerId && a.status === OrderStatus.ASSIGNED);
              const nextPrinterId = stillAssigned ? stillAssigned.printerId : null;

              const updatedOrder = { 
                  ...order, 
                  plateAssignments: newAssignments, 
                  assignedPrinterId: nextPrinterId, 
                  status: newStatus 
              };
              
              // REFUND FILAMENT
              let newStock = filamentStock;
              if (wasAssigned) {
                 newStock = updateOrderFilament([order], orderId, plateId, 'REFUND', filamentStock);
                 await db.saveFilamentStock(newStock);
                 setFilamentStock(newStock);
              }

              // Update Orders
              setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
              await db.saveOrder(sanitizeOrder(updatedOrder));
           }
           return;
        }

        // 2. Assignment Logic (Queued -> Assigned) or Reorder (Assigned -> Assigned)
        const sourceOrder = orders.find(o => o.id === orderId);
        if (!sourceOrder) return;
        
        const prevStatus = sourceOrder.plateAssignments[plateId]?.status || OrderStatus.QUEUED;
        const isNewAssignment = prevStatus === OrderStatus.QUEUED;

        // Build current queue for the target printer
        let printerQueue: { orderId: string, plateId: string, orderIndex: number }[] = [];
        
        orders.forEach(o => {
          const tmpl = templates.find(t => t.id === o.templateId);
          if(!tmpl || !tmpl.plates) return;
          
          tmpl.plates.forEach(p => {
             const assign = o.plateAssignments?.[p.id];
             if (assign && assign.printerId === targetPrinterId && assign.status === OrderStatus.ASSIGNED) {
                if (o.id === orderId && p.id === plateId) return;
                printerQueue.push({
                   orderId: o.id,
                   plateId: p.id,
                   orderIndex: assign.orderIndex || 0
                });
             }
          });
        });

        printerQueue.sort((a, b) => a.orderIndex - b.orderIndex);

        let insertAt = targetIndex !== undefined ? targetIndex : printerQueue.length;
        if (insertAt < 0) insertAt = 0;
        if (insertAt > printerQueue.length) insertAt = printerQueue.length;

        const newItem = { orderId, plateId, orderIndex: 0 }; 
        printerQueue.splice(insertAt, 0, newItem);

        // Prepare Updates
        const updatesByOrder: Record<string, Order> = {};
        const getOrder = (id: string) => {
           if (updatesByOrder[id]) return updatesByOrder[id];
           const existing = orders.find(o => o.id === id);
           if (existing) {
              // Shallow clone with deep copy of plateAssignments
              updatesByOrder[id] = { ...existing, plateAssignments: { ...existing.plateAssignments } };
              return updatesByOrder[id];
           }
           return null;
        };

        printerQueue.forEach((item, idx) => {
           const o = getOrder(item.orderId);
           if (o && o.plateAssignments[item.plateId]) {
              o.plateAssignments[item.plateId] = {
                 ...o.plateAssignments[item.plateId],
                 printerId: targetPrinterId,
                 orderIndex: idx,
                 status: o.plateAssignments[item.plateId].status === OrderStatus.QUEUED ? OrderStatus.ASSIGNED : o.plateAssignments[item.plateId].status
              };
           }
        });

        // Handle Legacy + Status Update
        const movingOrder = getOrder(orderId);
        if (movingOrder) {
           movingOrder.assignedPrinterId = targetPrinterId;
           const allAssignments = Object.values(movingOrder.plateAssignments);
           const allPrinted = allAssignments.every((a: any) => a.status === OrderStatus.PRINTED);
           const anyAssigned = allAssignments.some((a: any) => a.status === OrderStatus.ASSIGNED || a.status === OrderStatus.PRINTED);
           movingOrder.status = allPrinted ? OrderStatus.PRINTED : (anyAssigned ? OrderStatus.ASSIGNED : OrderStatus.QUEUED);
        }

        // DEDUCT FILAMENT if isNewAssignment
        if (isNewAssignment) {
           const newStock = updateOrderFilament([sourceOrder], orderId, plateId, 'DEDUCT', filamentStock);
           await db.saveFilamentStock(newStock);
           setFilamentStock(newStock);
        }

        const updatedOrdersList = Object.values(updatesByOrder);
        setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
        await Promise.all(updatedOrdersList.map(o => db.saveOrder(sanitizeOrder(o))));

    } catch (error) {
        console.error("Error moving plate", error);
    } finally {
        setIsGlobalProcessing(false);
    }

  }, [orders, templates, isGlobalProcessing, filamentStock, wastePercentage]);

  const handleMoveBatch = useCallback(async (
      items: { orderId: string, plateId: string }[], 
      targetPrinterId: string | null,
      targetBatchId?: string | null // Optional: Force items into a specific batch (Merge)
  ) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);

    try {
        const updatesByOrder: Record<string, Order> = {};
        let tempStock = [...filamentStock];
        let stockChanged = false;

        const getOrder = (id: string) => {
            if (updatesByOrder[id]) return updatesByOrder[id];
            const existing = orders.find(o => o.id === id);
            if (existing) {
                updatesByOrder[id] = { ...existing, plateAssignments: { ...existing.plateAssignments } };
                return updatesByOrder[id];
            }
            return null;
        };
        
        // If moving to a printer, we need to know the current highest index on that printer to append
        let currentPrinterIndex = 0;
        if (targetPrinterId) {
            orders.forEach(o => {
                Object.values(o.plateAssignments).forEach((assign: any) => {
                    if (assign.printerId === targetPrinterId && assign.status === OrderStatus.ASSIGNED) {
                        if ((assign.orderIndex || 0) >= currentPrinterIndex) {
                            currentPrinterIndex = (assign.orderIndex || 0) + 1;
                        }
                    }
                });
            });
        }

        for (const item of items) {
            const order = getOrder(item.orderId);
            if (order && order.plateAssignments[item.plateId]) {
                const prevAssignment = order.plateAssignments[item.plateId];
                const wasQueued = prevAssignment.status === OrderStatus.QUEUED;
                const wasAssigned = prevAssignment.status === OrderStatus.ASSIGNED;
                const oldBatchId = prevAssignment.batchId;
                
                // UNASSIGN Logic
                if (!targetPrinterId) {
                    if (wasAssigned) {
                         // Refund
                         tempStock = updateOrderFilament([order], order.id, item.plateId, 'REFUND', tempStock);
                         stockChanged = true;
                    }
                    order.plateAssignments[item.plateId] = {
                        printerId: null,
                        status: OrderStatus.QUEUED,
                        orderIndex: 0,
                        batchId: null // FIX: Clear batch ID when unassigned using null (not undefined)
                    };
                    order.assignedPrinterId = null; // Clear legacy
                } 
                // ASSIGN Logic
                else {
                    if (wasQueued) {
                        // Deduct
                         tempStock = updateOrderFilament([order], order.id, item.plateId, 'DEDUCT', tempStock);
                         stockChanged = true;
                    }
                    
                    // Batch ID Logic:
                    // If targetBatchId is provided (string), force use it (Merging)
                    // If targetBatchId is passed as null (explicit merge into default), make it null.
                    // If targetBatchId is undefined (just moving, not merging), preserve old (or default to null if missing)
                    
                    let newBatchId = oldBatchId || null;
                    if (targetBatchId !== undefined) {
                        newBatchId = targetBatchId; // null or string
                    }

                    order.plateAssignments[item.plateId] = {
                        printerId: targetPrinterId,
                        status: OrderStatus.ASSIGNED,
                        orderIndex: currentPrinterIndex,
                        batchId: newBatchId
                    };
                    currentPrinterIndex++;
                    order.assignedPrinterId = targetPrinterId; // Set legacy
                }

                // Update Overall Status
                const allValues = Object.values(order.plateAssignments) as PlateAssignment[];
                const allPrinted = allValues.every(a => a.status === OrderStatus.PRINTED);
                const anyAssigned = allValues.some(a => a.status === OrderStatus.ASSIGNED || a.status === OrderStatus.PRINTED);
                order.status = allPrinted ? OrderStatus.PRINTED : (anyAssigned ? OrderStatus.ASSIGNED : OrderStatus.QUEUED);
            }
        }

        if (stockChanged) {
            await db.saveFilamentStock(tempStock);
            setFilamentStock(tempStock);
        }

        const updatedList = Object.values(updatesByOrder);
        if (updatedList.length > 0) {
            setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
            await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
        }

    } catch (e) {
        console.error("Batch move error", e);
    } finally {
        setIsGlobalProcessing(false);
    }
  }, [orders, isGlobalProcessing, filamentStock, wastePercentage]);

  const handleMergeBatches = useCallback(async (
      sourceItems: { orderId: string, plateId: string }[],
      targetItems: { orderId: string, plateId: string }[],
      printerId: string
  ) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          const newBatchId = `batch-${Date.now()}`;
          const updatesByOrder: Record<string, Order> = {};
          const allItems = [...sourceItems, ...targetItems];

          // We need to know where to append if moving across printers, but usually merge happens on same printer or target printer
          // Assume target printer is the authority
          
          let currentPrinterIndex = 0;
          orders.forEach(o => {
              Object.values(o.plateAssignments).forEach((assign: any) => {
                  if (assign.printerId === printerId && assign.status === OrderStatus.ASSIGNED) {
                      if ((assign.orderIndex || 0) >= currentPrinterIndex) {
                          currentPrinterIndex = (assign.orderIndex || 0) + 1;
                      }
                  }
              });
          });

          for (const item of allItems) {
              let order = updatesByOrder[item.orderId] || orders.find(o => o.id === item.orderId);
              if (order) {
                   if (!updatesByOrder[item.orderId]) {
                      order = { ...order, plateAssignments: { ...order.plateAssignments } };
                      updatesByOrder[item.orderId] = order;
                   }
                   
                   const assignment = order.plateAssignments[item.plateId];
                   if (assignment) {
                       // If source item was elsewhere, move it
                       if (assignment.printerId !== printerId) {
                           assignment.printerId = printerId;
                           assignment.orderIndex = currentPrinterIndex++;
                           // Assuming deduction happened already if it was ASSIGNED elsewhere
                       }
                       
                       // Unify Batch ID
                       assignment.batchId = newBatchId;
                       assignment.status = OrderStatus.ASSIGNED; // Ensure active
                   }
              }
          }

          const updatedList = Object.values(updatesByOrder);
          if (updatedList.length > 0) {
            setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
            await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
          }

      } catch (e) {
          console.error("Merge batches error", e);
      } finally {
          setIsGlobalProcessing(false);
      }
  }, [orders, isGlobalProcessing]);

  const handleSplitBatch = useCallback(async (
      items: { orderId: string, plateId: string }[], 
      count: number
  ) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          const newBatchId = `batch-${Date.now()}`;
          const updatesByOrder: Record<string, Order> = {};
          
          // We assume 'items' is the list of items to MOVE to the new batch
          // The PrintingTab logic selects the last N items.
          
          for (const item of items) {
              let order = updatesByOrder[item.orderId] || orders.find(o => o.id === item.orderId);
              if (order) {
                   if (!updatesByOrder[item.orderId]) {
                      order = { ...order, plateAssignments: { ...order.plateAssignments } };
                      updatesByOrder[item.orderId] = order;
                   }
                   
                   if (order.plateAssignments[item.plateId]) {
                       order.plateAssignments[item.plateId].batchId = newBatchId;
                   }
              }
          }
          
          const updatedList = Object.values(updatesByOrder);
          if (updatedList.length > 0) {
            setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
            await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
          }

      } catch (e) {
          console.error("Split batch error", e);
      } finally {
          setIsGlobalProcessing(false);
      }
  }, [orders, isGlobalProcessing]);


  const handlePlateStatusChange = useCallback(async (orderId: string, plateId: string, newPlateStatus: OrderStatus) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    
    try {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const prevStatus = order.plateAssignments[plateId]?.status;
          
          // Edge Case: If marking as PRINTED directly from QUEUED (bypassing Assigned)
          // We should deduct filament
          let currentStock = filamentStock;
          if (prevStatus === OrderStatus.QUEUED && newPlateStatus === OrderStatus.PRINTED) {
             currentStock = updateOrderFilament([order], orderId, plateId, 'DEDUCT', currentStock);
             await db.saveFilamentStock(currentStock);
             setFilamentStock(currentStock);
          }

          const newAssignments = { ...order.plateAssignments };
          if(newAssignments[plateId]) {
             newAssignments[plateId] = { ...newAssignments[plateId], status: newPlateStatus };
          }
          
          const allValues: PlateAssignment[] = Object.values(newAssignments);
          const allPrinted = allValues.every((a: PlateAssignment) => a.status === OrderStatus.PRINTED);
          const newOrderStatus = allPrinted ? OrderStatus.PRINTED : OrderStatus.ASSIGNED;

          const updated = { ...order, plateAssignments: newAssignments, status: newOrderStatus };
          setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
          await db.saveOrder(sanitizeOrder(updated));
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsGlobalProcessing(false);
    }
  }, [orders, isGlobalProcessing, filamentStock, wastePercentage]);
  
  // Handle Batch Completion of Plates + Surplus to Stock
  const handleBatchComplete = useCallback(async (
      assignments: { orderId: string, plateId: string }[], 
      surplusCount: number, 
      plateDetails: { name: string, colors: string[], plateId: string, templateId: string }
  ) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          // 1. Update Assignments to PRINTED
          const updatesByOrder: Record<string, Order> = {};
          
          for (const item of assignments) {
             let order = updatesByOrder[item.orderId] || orders.find(o => o.id === item.orderId);
             if (order) {
                 // Clone if first time touching this order in this batch
                 if (!updatesByOrder[item.orderId]) {
                    order = { ...order, plateAssignments: { ...order.plateAssignments } };
                    updatesByOrder[item.orderId] = order;
                 }
                 
                 // Update status
                 if (order.plateAssignments[item.plateId]) {
                    order.plateAssignments[item.plateId].status = OrderStatus.PRINTED;
                 }
                 
                 // Check overall order status
                 const allValues: PlateAssignment[] = Object.values(order.plateAssignments);
                 const allPrinted = allValues.every((a) => a.status === OrderStatus.PRINTED);
                 order.status = allPrinted ? OrderStatus.PRINTED : OrderStatus.ASSIGNED;
             }
          }

          const updatedOrdersList = Object.values(updatesByOrder);
          if (updatedOrdersList.length > 0) {
             setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
             await Promise.all(updatedOrdersList.map(o => db.saveOrder(sanitizeOrder(o))));
          }

          // 2. Handle Surplus -> Add to Stock (Type: PART)
          if (surplusCount > 0) {
              // Construct stock ID based on plate details
              const colorKey = plateDetails.colors.slice().sort().join('+');
              const stockId = `PART_${plateDetails.plateId}_${colorKey}`;
              
              const existingItem = stockItems.find(i => i.id === stockId);
              const newItem: StockItem = existingItem 
                  ? { ...existingItem, quantity: existingItem.quantity + surplusCount }
                  : { 
                      id: stockId, 
                      templateId: plateDetails.templateId, // Context
                      plateId: plateDetails.plateId,
                      type: 'PART',
                      colors: plateDetails.colors, 
                      quantity: surplusCount,
                      isCustom: false // usually standard if grouped
                    };
              
              await db.saveStockItem(newItem);
              
              // IMPORTANT: Update local state for stock to avoid reloading
              setStockItems(prev => {
                  const others = prev.filter(i => i.id !== newItem.id);
                  return [...others, newItem];
              });

              // --- SURPLUS FILAMENT DEDUCTION ---
              const tmpl = templates.find(t => t.id === plateDetails.templateId);
              if (tmpl && tmpl.plates) {
                 const plate = tmpl.plates.find(p => p.id === plateDetails.plateId);
                 if (plate && plate.filamentUsage && plate.filamentUsage.length > 0) {
                     const wasteMultiplier = 1 + (wastePercentage / 100);
                     let tempStock = [...filamentStock];
                     let stockChanged = false;

                     plateDetails.colors.forEach((color, index) => {
                        let weight = 0;
                        if (plate.filamentUsage && plate.filamentUsage.length > index) {
                           weight = plate.filamentUsage[index];
                        } else if (plate.filamentUsage && plate.filamentUsage.length === 1) {
                           weight = plate.filamentUsage[0];
                        }

                        if (weight > 0) {
                           const finalWeight = weight * wasteMultiplier * surplusCount;
                           tempStock = calculateNewStock(tempStock, color, plate.filamentType, -finalWeight);
                           stockChanged = true;
                        }
                     });

                     if (stockChanged) {
                        await db.saveFilamentStock(tempStock);
                        setFilamentStock(tempStock);
                     }
                 }
              }
          }

      } catch (e) {
          console.error("Batch complete error", e);
      } finally {
          setIsGlobalProcessing(false);
      }
  }, [orders, stockItems, isGlobalProcessing, filamentStock, wastePercentage, templates]);

  const handleRevertBatch = useCallback(async (items: { orderId: string, plateId: string }[]) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          const updatesByOrder: Record<string, Order> = {};

          for (const item of items) {
              let order = updatesByOrder[item.orderId] || orders.find(o => o.id === item.orderId);
              if (order) {
                  if (!updatesByOrder[item.orderId]) {
                       order = { ...order, plateAssignments: { ...order.plateAssignments } };
                       updatesByOrder[item.orderId] = order;
                  }
                  
                  if (order.plateAssignments[item.plateId]) {
                      order.plateAssignments[item.plateId].status = OrderStatus.ASSIGNED;
                  }
                  
                  // Re-evaluate global status
                  const allVals = Object.values(order.plateAssignments) as PlateAssignment[];
                  const allPrinted = allVals.every(a => a.status === OrderStatus.PRINTED);
                  order.status = allPrinted ? OrderStatus.PRINTED : OrderStatus.ASSIGNED;
              }
          }

          const updatedList = Object.values(updatesByOrder);
          if (updatedList.length > 0) {
              setOrders(prev => prev.map(o => updatesByOrder[o.id] || o));
              await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
          }
      } catch (e) {
          console.error("Batch revert error", e);
      } finally {
          setIsGlobalProcessing(false);
      }
  }, [orders, isGlobalProcessing]);

  // Handle Global Auto-Batch (Group items active on any printer -> merge to single printer)
  const handleAutoBatchAll = useCallback(async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const updatesByOrder: Record<string, Order> = {};
        
        // Helper to get mutable order (shallow clone)
        const getOrder = (id: string) => {
           if (updatesByOrder[id]) return updatesByOrder[id];
           const existing = orders.find(o => o.id === id);
           if (existing) {
              updatesByOrder[id] = { ...existing, plateAssignments: { ...existing.plateAssignments } };
              return updatesByOrder[id];
           }
           return null;
        };

        // 1. Analyze current max indexes to append correctly
        const printerMaxIndexes: Record<string, number> = {};
        printers.forEach(p => printerMaxIndexes[p.id] = -1);
        
        orders.forEach(o => {
            Object.values(o.plateAssignments).forEach((assign: any) => {
                if (assign.printerId && assign.status === OrderStatus.ASSIGNED) {
                    const idx = assign.orderIndex ?? 0;
                    if (idx > printerMaxIndexes[assign.printerId]) {
                        printerMaxIndexes[assign.printerId] = idx;
                    }
                }
            });
        });

        // 2. Group all ASSIGNED items by Global Signature (Name + Colors + Weight + Time + Type)
        // Ignoring TemplateID allows parts from different products to merge.
        interface ItemRef { 
            orderId: string; 
            plateId: string; 
            printerId: string;
            currentBatchId?: string | null;
        }
        const groups: Record<string, ItemRef[]> = {};

        orders.forEach(o => {
            const tmpl = templates.find(t => t.id === o.templateId);
            if (!tmpl || !tmpl.plates) return;
            
            Object.entries(o.plateAssignments || {}).forEach(([plateId, assign]) => {
                const assignment = assign as PlateAssignment;
                // Only consider ASSIGNED items (on printers)
                if (assignment.printerId && assignment.status === OrderStatus.ASSIGNED) {
                    const plate = tmpl.plates.find(p => p.id === plateId);
                    if (!plate) return;

                    const specificColors = o.plateSpecificColors?.[plateId];
                    const activeColors = (specificColors && specificColors.length > 0) ? specificColors : o.selectedColors;
                    
                    // Calc weight
                    let totalWeight = 0;
                    if (plate.filamentUsage) {
                        if (activeColors.length > 1 && plate.filamentUsage.length === activeColors.length) {
                             totalWeight = plate.filamentUsage.reduce((a, b) => a + b, 0);
                        } else {
                             totalWeight = plate.filamentUsage[0] || 0;
                        }
                    }

                    // Key excluding TemplateID
                    // Use fixed precision to avoid floating point mismatches in string key
                    const wKey = totalWeight.toFixed(2);
                    const tKey = plate.printTimeMinutes.toFixed(1);
                    const colorKey = activeColors.slice().sort().join('-');

                    const key = `${plate.name}::${colorKey}::${wKey}::${tKey}::${plate.filamentType}`;
                    
                    if (!groups[key]) groups[key] = [];
                    groups[key].push({ 
                        orderId: o.id, 
                        plateId, 
                        printerId: assignment.printerId, 
                        currentBatchId: assignment.batchId
                    });
                }
            });
        });

        // 3. Process Groups
        for (const [key, items] of Object.entries(groups)) {
            if (items.length < 2) continue; // Need at least 2 items to batch

            // Find Target Printer (Highest count of items)
            const printerCounts: Record<string, number> = {};
            items.forEach(i => {
                printerCounts[i.printerId] = (printerCounts[i.printerId] || 0) + 1;
            });

            // Sort descending by count
            const sortedPrinters = Object.entries(printerCounts).sort((a, b) => b[1] - a[1]);
            const targetPrinterId = sortedPrinters[0][0];

            // Generate new Batch ID
            const newBatchId = `batch-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

            for (const item of items) {
                const order = getOrder(item.orderId);
                if (!order) continue;
                const assignment = order.plateAssignments[item.plateId];

                // Update Batch ID
                assignment.batchId = newBatchId;

                // Move if needed
                if (item.printerId !== targetPrinterId) {
                    assignment.printerId = targetPrinterId;
                    
                    // Append to end of target queue
                    printerMaxIndexes[targetPrinterId] += 1;
                    assignment.orderIndex = printerMaxIndexes[targetPrinterId];
                    
                    // Update legacy field
                    order.assignedPrinterId = targetPrinterId;
                }
            }
        }

        const updatedList = Object.values(updatesByOrder);
        if (updatedList.length > 0) {
            setOrders(prev => {
                const map = new Map(prev.map(p => [p.id, p]));
                updatedList.forEach(u => map.set(u.id, u));
                return Array.from(map.values());
            });
            await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
        }

    } catch (e) {
        console.error("Auto batch error", e);
    } finally {
        setIsGlobalProcessing(false);
    }
  }, [orders, templates, printers, isGlobalProcessing]);

  // Handle Clearing Completed Items (Remove from Printer UI but keep Printed Status)
  const handleClearCompleted = useCallback(async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
       const updatesByOrder: Record<string, Order> = {};
       
       orders.forEach(o => {
          let hasChanges = false;
          // Deep clone order assignments if we haven't touched it yet
          const newAssignments = o.plateAssignments ? { ...o.plateAssignments } : {};
          
          Object.keys(newAssignments).forEach(plateId => {
             const assign = newAssignments[plateId];
             // If it occupies a printer BUT is done (PRINTED)
             if (assign.printerId && assign.status === OrderStatus.PRINTED) {
                 newAssignments[plateId] = { ...assign, printerId: null };
                 hasChanges = true;
             }
          });

          if (hasChanges) {
             const updatedOrder = { ...o, plateAssignments: newAssignments };
             // Update Legacy Logic
             const allPrinted = (Object.values(newAssignments) as PlateAssignment[]).every(a => a.status === OrderStatus.PRINTED);
             if (allPrinted) updatedOrder.assignedPrinterId = null;

             updatesByOrder[o.id] = updatedOrder;
          }
       });

       const updatedList = Object.values(updatesByOrder);
       if (updatedList.length > 0) {
          setOrders(prev => {
             const map = new Map(prev.map(p => [p.id, p]));
             updatedList.forEach(u => map.set(u.id, u));
             return Array.from(map.values());
          });
          await Promise.all(updatedList.map(o => db.saveOrder(sanitizeOrder(o))));
       }
    } catch (e) {
       console.error("Clear completed error", e);
    } finally {
       setIsGlobalProcessing(false);
    }
  }, [orders, isGlobalProcessing]);

    const handleAutoDistribute = useCallback(async () => {
     if (isGlobalProcessing) return;
     setIsGlobalProcessing(true); // Using global blocker instead of white screen loader
     try {
       const activePrinters = printers.filter(p => !p.isMaintenance);
       if (activePrinters.length === 0) {
         alert('No available printers.');
         return;
       }
       interface DaySchedule {
         usedMinutes: number;
         jobCount: number;
         maxMinutes: number;
       }
       interface Placement {
         dayKey: string;
         addedMinutes: number;
         completionTs: number;
         dayMaxMinutes: number;
         usedExtended: boolean;
       }
       interface QueueItem {
         orderId: string;
         plateId: string;
         plate: Plate;
         template: ProductTemplate;
         colors: string[];
         signature: string;
         printDeadlineAt: number | null;
         orderDeadlineAt: number | null;
         createdAt: number;
       }
       const templatesById = new Map(templates.map(t => [t.id, t]));
       const todayDayKey = (() => {
         let dayKey = toDayKeyInLA(Date.now());
         while (!isWorkingDayKey(dayKey)) {
           dayKey = nextDayKey(dayKey);
         }
         return dayKey;
       })();
       const updates: Order[] = [];
       const simulatedOrders = orders.map(o => {
         const newAssignments: Record<string, PlateAssignment> = {};
         if (o.plateAssignments) {
           Object.keys(o.plateAssignments).forEach((k) => {
             const v = o.plateAssignments[k];
             if (v) {
               newAssignments[k] = sanitizeAssignment(v);
             }
           });
         }
         return { ...o, plateAssignments: newAssignments };
       });
       const ordersById = new Map(simulatedOrders.map(o => [o.id, o]));
       const printerDayState: Record<string, Record<string, DaySchedule>> = {};
       const printerNextIndex: Record<string, number> = {};
       const printerSignatures: Record<string, Set<string>> = {};
       activePrinters.forEach(p => {
         printerDayState[p.id] = {};
         printerNextIndex[p.id] = 0;
         printerSignatures[p.id] = new Set<string>();
       });
       const ensureDaySchedule = (printerId: string, dayKey: string): DaySchedule => {
         if (!printerDayState[printerId][dayKey]) {
           printerDayState[printerId][dayKey] = {
             usedMinutes: 0,
             jobCount: 0,
             maxMinutes: PRINTER_NORMAL_DAY_MINUTES
           };
         }
         return printerDayState[printerId][dayKey];
       };
       const findPlacement = (
         printerId: string,
         printMinutes: number,
         desiredDayMaxMinutes: number
       ): Placement | null => {
         let dayKey = todayDayKey;
         const safetyLimit = 240;
         for (let i = 0; i < safetyLimit; i++) {
           if (isWorkingDayKey(dayKey)) {
             const state = ensureDaySchedule(printerId, dayKey);
             const pauseMinutes = state.jobCount > 0 ? PRINTER_CHANGEOVER_MINUTES : 0;
             const neededMinutes = printMinutes + pauseMinutes;
             const dayMaxMinutes = Math.max(state.maxMinutes, desiredDayMaxMinutes);
             if ((state.usedMinutes + neededMinutes) <= dayMaxMinutes) {
               const projectedEnd = state.usedMinutes + neededMinutes;
               const dayStartTs = dayKeyToUtc(dayKey, PRINTER_DAY_START_HOUR, 0);
               return {
                 dayKey,
                 addedMinutes: neededMinutes,
                 completionTs: dayStartTs + projectedEnd * 60 * 1000,
                 dayMaxMinutes,
                 usedExtended: projectedEnd > PRINTER_NORMAL_DAY_MINUTES
               };
             }
           }
           dayKey = nextDayKey(dayKey);
         }
         return null;
       };
       const applyPlacement = (printerId: string, placement: Placement) => {
         const day = ensureDaySchedule(printerId, placement.dayKey);
         day.maxMinutes = Math.max(day.maxMinutes, placement.dayMaxMinutes);
         day.usedMinutes += placement.addedMinutes;
         day.jobCount += 1;
       };
       activePrinters.forEach(printer => {
         const existingJobs: QueueItem[] = [];
         simulatedOrders.forEach(order => {
           const tmpl = templatesById.get(order.templateId);
           if (!tmpl || !tmpl.plates) return;
           tmpl.plates.forEach(plate => {
             const assignment = order.plateAssignments?.[plate.id];
             if (!assignment || assignment.status !== OrderStatus.ASSIGNED || assignment.printerId !== printer.id) return;
             const specificColors = order.plateSpecificColors?.[plate.id];
             const colors = (specificColors && specificColors.length > 0) ? specificColors : order.selectedColors;
             let weight = 0;
             if (plate.filamentUsage) {
               if (colors.length > 1 && plate.filamentUsage.length === colors.length) {
                 weight = plate.filamentUsage.reduce((a, b) => a + b, 0);
               } else {
                 weight = plate.filamentUsage[0] || 0;
               }
             }
             existingJobs.push({
               orderId: order.id,
               plateId: plate.id,
               plate,
               template: tmpl,
               colors,
               signature: makePlateSignature(plate.name, colors, weight, plate.printTimeMinutes, plate.filamentType),
               printDeadlineAt: computePrintDeadline(order, tmpl),
               orderDeadlineAt: order.deadlineAt || null,
               createdAt: order.createdAt || 0
             });
             const idx = assignment.orderIndex || 0;
             if (idx >= printerNextIndex[printer.id]) {
               printerNextIndex[printer.id] = idx + 1;
             }
           });
         });
         existingJobs.sort((a, b) => {
           const aOrder = ordersById.get(a.orderId);
           const bOrder = ordersById.get(b.orderId);
           const aIdx = aOrder?.plateAssignments?.[a.plateId]?.orderIndex || 0;
           const bIdx = bOrder?.plateAssignments?.[b.plateId]?.orderIndex || 0;
           return aIdx - bIdx;
         });
         existingJobs.forEach(job => {
           const placement = findPlacement(printer.id, job.plate.printTimeMinutes, PRINTER_NORMAL_DAY_MINUTES)
             || findPlacement(printer.id, job.plate.printTimeMinutes, PRINTER_EXTENDED_DAY_MINUTES);
           if (!placement) return;
           applyPlacement(printer.id, placement);
           printerSignatures[printer.id].add(job.signature);
         });
       });
       let tempStock = [...filamentStock];
       let stockChanged = false;
       const queue: QueueItem[] = [];
       const schedulingFlags = new Map<string, { needsManual: boolean; usesExtended: boolean }>();
       simulatedOrders.forEach(order => {
         if ([OrderStatus.PRINTED, OrderStatus.ASSEMBLED, OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.STORED].includes(order.status)) return;
         const tmpl = templatesById.get(order.templateId);
         if (!tmpl || !tmpl.plates) return;
         tmpl.plates.forEach(plate => {
           const assignment = order.plateAssignments?.[plate.id];
           if (!assignment || assignment.status !== OrderStatus.QUEUED || assignment.printerId) return;
           const specificColors = order.plateSpecificColors?.[plate.id];
           const colors = (specificColors && specificColors.length > 0) ? specificColors : order.selectedColors;
           let weight = 0;
           if (plate.filamentUsage) {
             if (colors.length > 1 && plate.filamentUsage.length === colors.length) {
               weight = plate.filamentUsage.reduce((a, b) => a + b, 0);
             } else {
               weight = plate.filamentUsage[0] || 0;
             }
           }
           if (!schedulingFlags.has(order.id)) {
             schedulingFlags.set(order.id, {
               needsManual: false,
               usesExtended: !!order.usesExtendedHours
             });
           }
           queue.push({
             orderId: order.id,
             plateId: plate.id,
             plate,
             template: tmpl,
             colors,
             signature: makePlateSignature(plate.name, colors, weight, plate.printTimeMinutes, plate.filamentType),
             printDeadlineAt: computePrintDeadline(order, tmpl),
             orderDeadlineAt: order.deadlineAt || null,
             createdAt: order.createdAt || 0
           });
         });
       });
       const nowTs = Date.now();
       queue.sort((a, b) => {
         const aOverdue = a.printDeadlineAt !== null && a.printDeadlineAt < nowTs;
         const bOverdue = b.printDeadlineAt !== null && b.printDeadlineAt < nowTs;
         if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

         const aDue = a.orderDeadlineAt ?? Number.MAX_SAFE_INTEGER;
         const bDue = b.orderDeadlineAt ?? Number.MAX_SAFE_INTEGER;
         if (aDue !== bDue) return aDue - bDue;
         if (a.orderId !== b.orderId) return a.createdAt - b.createdAt;
         return a.signature.localeCompare(b.signature);
       });
       for (const item of queue) {
         const orderToUpdate = ordersById.get(item.orderId);
         if (!orderToUpdate) continue;
         const flags = schedulingFlags.get(item.orderId) || { needsManual: false, usesExtended: false };
         const isOverdueForPrint = item.printDeadlineAt !== null && item.printDeadlineAt < nowTs;
         const isMultiColor = item.colors.length > 1;
         const candidates = activePrinters.filter(p => {
           if (isMultiColor && !p.isMultiColor) return false;
           if (!Array.isArray(p.supportedColors)) return false;
           return item.colors.every(c => p.supportedColors.includes(c));
         });
         if (candidates.length === 0) {
           flags.needsManual = true;
           schedulingFlags.set(item.orderId, flags);
           continue;
         }
         let best:
           | { printerId: string; placement: Placement; score: number; usedExtendedForDeadline: boolean }
           | null = null;
         for (const printer of candidates) {
           const normalPlacement = findPlacement(printer.id, item.plate.printTimeMinutes, PRINTER_NORMAL_DAY_MINUTES);
           let chosenPlacement = normalPlacement;
           let usedExtendedForDeadline = false;
           if (isOverdueForPrint) {
             chosenPlacement = normalPlacement || findPlacement(printer.id, item.plate.printTimeMinutes, PRINTER_EXTENDED_DAY_MINUTES);
           } else if (item.printDeadlineAt) {
             if (!normalPlacement || normalPlacement.completionTs > item.printDeadlineAt) {
               const extendedPlacement = findPlacement(printer.id, item.plate.printTimeMinutes, PRINTER_EXTENDED_DAY_MINUTES);
               if (extendedPlacement && extendedPlacement.completionTs <= item.printDeadlineAt) {
                 chosenPlacement = extendedPlacement;
                 usedExtendedForDeadline = true;
               } else {
                 chosenPlacement = null;
               }
             }
           } else if (!chosenPlacement) {
             chosenPlacement = findPlacement(printer.id, item.plate.printTimeMinutes, PRINTER_EXTENDED_DAY_MINUTES);
           }
           if (!chosenPlacement) continue;
           const groupingBonus = printerSignatures[printer.id].has(item.signature) ? -20 * 60 * 1000 : 0;
           const score = chosenPlacement.completionTs + groupingBonus;
           if (!best || score < best.score) {
             best = {
               printerId: printer.id,
               placement: chosenPlacement,
               score,
               usedExtendedForDeadline
             };
           }
         }
         if (!best) {
           flags.needsManual = true;
           schedulingFlags.set(item.orderId, flags);
           continue;
         }
         applyPlacement(best.printerId, best.placement);
         printerSignatures[best.printerId].add(item.signature);
         const assignment = orderToUpdate.plateAssignments[item.plateId];
         if (!assignment) {
           flags.needsManual = true;
           schedulingFlags.set(item.orderId, flags);
           continue;
         }
         assignment.printerId = best.printerId;
         assignment.status = OrderStatus.ASSIGNED;
         assignment.orderIndex = printerNextIndex[best.printerId];
         printerNextIndex[best.printerId] += 1;
         orderToUpdate.assignedPrinterId = best.printerId;
         if (best.placement.usedExtended || best.usedExtendedForDeadline) {
           flags.usesExtended = true;
         }
         schedulingFlags.set(item.orderId, flags);
         tempStock = updateOrderFilament([orderToUpdate], item.orderId, item.plateId, 'DEDUCT', tempStock);
         stockChanged = true;
       }
       const manualOrders: string[] = [];
       simulatedOrders.forEach(order => {
         const original = orders.find(o => o.id === order.id);
         if (!original) return;
         const flags = schedulingFlags.get(order.id);
         if (flags) {
           order.needsManualScheduling = flags.needsManual;
           order.usesExtendedHours = flags.usesExtended;
           if (flags.needsManual && order.etsyOrderId) {
             manualOrders.push(order.etsyOrderId);
           }
         }
         const assignments = Object.values(order.plateAssignments) as PlateAssignment[];
         const allPrinted = assignments.length > 0 && assignments.every(a => a.status === OrderStatus.PRINTED);
         const someActive = assignments.some(a => a.status === OrderStatus.ASSIGNED || a.status === OrderStatus.PRINTED);
         order.status = allPrinted ? OrderStatus.PRINTED : (someActive ? OrderStatus.ASSIGNED : OrderStatus.QUEUED);
         let hasChange = false;
         const assignmentKeys = new Set([
           ...Object.keys(order.plateAssignments || {}),
           ...Object.keys(original.plateAssignments || {})
         ]);
         for (const pid of assignmentKeys) {
           const newAssign = order.plateAssignments[pid] as PlateAssignment | undefined;
           const oldAssign = original.plateAssignments[pid] as PlateAssignment | undefined;
           if (
             (newAssign?.printerId || null) !== (oldAssign?.printerId || null) ||
             newAssign?.status !== oldAssign?.status ||
             (newAssign?.orderIndex || 0) !== (oldAssign?.orderIndex || 0)
           ) {
             hasChange = true;
             break;
           }
         }
         if (
           hasChange ||
           order.status !== original.status ||
           !!order.needsManualScheduling !== !!original.needsManualScheduling ||
           !!order.usesExtendedHours !== !!original.usesExtendedHours ||
           order.assignedPrinterId !== original.assignedPrinterId
         ) {
           updates.push(order);
         }
       });
       if (updates.length > 0) {
         const sanitizedUpdates = updates.map(u => sanitizeOrder(u));
         const saveResults = await Promise.allSettled(sanitizedUpdates.map(u => db.saveOrder(u)));
         const successfulUpdates: Order[] = [];

         saveResults.forEach((res, idx) => {
           if (res.status === 'fulfilled') {
             successfulUpdates.push(sanitizedUpdates[idx]);
           } else {
             console.error('Auto-distribute save failed for order', sanitizedUpdates[idx]?.id, res.reason);
           }
         });

         if (stockChanged && successfulUpdates.length > 0) {
           try {
             await db.saveFilamentStock(tempStock);
             setFilamentStock(tempStock);
           } catch (stockErr) {
             console.error('Auto-distribute: filament stock save failed', stockErr);
           }
         }

         if (successfulUpdates.length > 0) {
           setOrders(prev => {
             const map = new Map(prev.map(p => [p.id, p]));
             successfulUpdates.forEach(u => map.set(u.id, u));
             return Array.from(map.values());
           });
         }
       } else if (queue.length === 0) {
         alert('No queued tasks for auto-distribution.');
       } else {
         alert('Auto-distribution made no changes. Check color compatibility and deadlines.');
       }
       if (manualOrders.length > 0) {
         alert(`Manual scheduling required: ${manualOrders.length} order(s) cannot meet the deadline.`);
       }
     } catch (e) {
        console.error("Auto distribute error", e);
        alert("Auto-distribution failed");
     } finally {
        setIsGlobalProcessing(false);
     }
  }, [orders, printers, templates, isGlobalProcessing, filamentStock, wastePercentage]);

  const handleClearDistribution = useCallback(async () => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    
    try {
      const updates: Order[] = [];
      let tempStock = [...filamentStock];
      let stockChanged = false;

      orders.forEach(order => {
        if ([OrderStatus.ASSEMBLED, OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.STORED].includes(order.status)) return;
        
        const newAssignments: Record<string, PlateAssignment> = order.plateAssignments ? { ...order.plateAssignments } : {};
        let changed = false;
        
        if (newAssignments && Object.keys(newAssignments).length > 0) {
            Object.keys(newAssignments).forEach(plateId => {
               const assignment = newAssignments[plateId];
               // Reset if it has a printer assigned OR if the status is not QUEUED
               // BUT NOT if it is PRINTED (Already consumed material and done)
               if (assignment && assignment.status !== OrderStatus.PRINTED && (assignment.printerId || assignment.status !== OrderStatus.QUEUED)) {
                 
                 // Refund Filament
                 tempStock = updateOrderFilament([order], order.id, plateId, 'REFUND', tempStock);
                 stockChanged = true;

                 newAssignments[plateId] = { ...assignment, printerId: null, status: OrderStatus.QUEUED, orderIndex: 0 };
                 changed = true;
               }
            });
        }
        
        if (order.assignedPrinterId) {
            changed = true;
        }

        if (changed) {
           updates.push({
             ...order,
             plateAssignments: newAssignments,
             assignedPrinterId: null,
             status: OrderStatus.QUEUED,
             usesExtendedHours: false,
             needsManualScheduling: false
           });
        }
      });

      if (updates.length > 0) {
        setOrders(prev => {
            const map = new Map(prev.map(p => [p.id, p]));
            updates.forEach(u => map.set(u.id, u)); // FIXED: updatedList -> updates
            return Array.from(map.values());
        });
        
        await Promise.all(updates.map(u => db.saveOrder(sanitizeOrder(u))));
        if(stockChanged) {
           await db.saveFilamentStock(tempStock);
           setFilamentStock(tempStock);
        }
      }
    } catch (e) {
      console.error("Clear dist error", e);
      alert("Ошибка сброса распределения");
    } finally {
      setIsGlobalProcessing(false);
    }
  }, [orders, isGlobalProcessing, filamentStock, wastePercentage]);


  const handleStatusChange = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        const order = orders.find(o => o.id === orderId);
        if (order) {
           await db.saveOrder(sanitizeOrder({ ...order, status: newStatus }));
        }
    } finally {
        setIsGlobalProcessing(false);
    }
  }, [orders, isGlobalProcessing]);

  const handleSendToWarehouse = async (orderId: string) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        
        let colorKey = '';
        if (order.plateSpecificColors) {
           const parts = Object.keys(order.plateSpecificColors).sort().map(pid => {
             const c = order.plateSpecificColors![pid];
             return `${pid}:${c.sort().join('+')}`;
           });
           colorKey = `PLATES_${parts.join('|')}`;
        } else {
           colorKey = `GLOBAL_${order.selectedColors.sort().join('-')}`;
        }
        const stockId = `${order.templateId}_${colorKey}`;
        
        const existingItem = stockItems.find(i => i.id === stockId);
        const newItem: StockItem = existingItem 
            ? { ...existingItem, quantity: existingItem.quantity + 1 }
            : { 
                id: stockId, 
                templateId: order.templateId, 
                type: 'PRODUCT', 
                colors: order.selectedColors, 
                quantity: 1, 
                isCustom: order.isCustomColor, 
                plateSpecificColors: order.plateSpecificColors 
              };
        
        await db.saveStockItem(newItem);
        
        // Update Local State for Stock
        setStockItems(prev => {
           const others = prev.filter(i => i.id !== newItem.id);
           return [...others, newItem];
        });

        // Update Local State for Orders
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: OrderStatus.STORED } : o));
        await db.saveOrder(sanitizeOrder({ ...order, status: OrderStatus.STORED }));

    } finally {
        setIsGlobalProcessing(false);
    }
  };

  const handleDecreaseStock = async (stockItemId: string, amount: number = 1) => {
     if (isGlobalProcessing) return;
     setIsGlobalProcessing(true);
     try {
         const item = stockItems.find(i => i.id === stockItemId);
         if (!item) return;
         if (item.quantity > amount) {
           const updated = { ...item, quantity: item.quantity - amount };
           await db.saveStockItem(updated);
           setStockItems(prev => prev.map(i => i.id === stockItemId ? updated : i));
         } else {
           await db.deleteStockItem(stockItemId);
           setStockItems(prev => prev.filter(i => i.id !== stockItemId));
         }
     } finally {
        setIsGlobalProcessing(false);
     }
  };

  const handleAddPartToStock = async (templateId: string, plateId: string, colors: string[], quantity: number) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const colorKey = colors.slice().sort().join('+');
        const stockId = `PART_${plateId}_${colorKey}`;

        const existingItem = stockItems.find(i => i.id === stockId);
        const newItem: StockItem = existingItem 
            ? { ...existingItem, quantity: existingItem.quantity + quantity }
            : { 
                id: stockId, 
                templateId: templateId, 
                plateId: plateId,
                type: 'PART',
                colors: colors, 
                quantity: quantity,
                isCustom: false 
              };
        
        await db.saveStockItem(newItem);
        setStockItems(prev => {
            const others = prev.filter(i => i.id !== newItem.id);
            return [...others, newItem];
        });
    } finally {
        setIsGlobalProcessing(false);
    }
  };
  
  const handleAddFilament = async (color: string, type: string, grams: number) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          const newStock = calculateNewStock(filamentStock, color, type, grams);
          setFilamentStock(newStock);
          await db.saveFilamentStock(newStock);
      } finally {
          setIsGlobalProcessing(false);
      }
  };
  
  const handleDeleteFilament = async (color: string, type: string) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          const newStock = filamentStock.filter(f => !(f.color === color && f.type === type));
          setFilamentStock(newStock);
          await db.saveFilamentStock(newStock);
      } finally {
          setIsGlobalProcessing(false);
      }
  };

  // Handle Saving Global Settings
  const handleSaveSettings = async (waste: number) => {
      if (isGlobalProcessing) return;
      setIsGlobalProcessing(true);
      try {
          setWastePercentage(waste);
          await db.saveGlobalSettings({ wastePercentage: waste });
      } finally {
          setIsGlobalProcessing(false);
      }
  };

  const handleAddOrder = async (
    templateId: string, 
    selectedColors: string[], 
    comments: string, 
    plateSpecificColors?: Record<string, string[]>, 
    isCustom?: boolean,
    initialStatus: OrderStatus = OrderStatus.QUEUED,
    initialPlateStatuses: Record<string, OrderStatus> = {},
    orderMeta?: OrderCreateMeta,
    quantity: number = 1
  ) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const tmpl = templates.find(t => t.id === templateId);
        const safeQty = Math.max(1, Math.floor(quantity || 1));
        const now = Date.now();
        const newOrders: Order[] = [];

        for (let i = 0; i < safeQty; i++) {
          const initialAssignments: Record<string, PlateAssignment> = {};
          if (tmpl && tmpl.plates) {
            tmpl.plates.forEach(p => {
              const specificStatus = initialPlateStatuses[p.id] || initialStatus;
              let status = OrderStatus.QUEUED;
              if (initialStatus === OrderStatus.ASSEMBLED || initialStatus === OrderStatus.PRINTED) {
                 status = OrderStatus.PRINTED;
              } else if (specificStatus) {
                 status = specificStatus;
              }

              initialAssignments[p.id] = { 
                 printerId: null, 
                 status: status, 
                 orderIndex: 0 
              };
            });
          }

          const stamp = now + i;
          const newOrder: Order = {
            id: `o-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
            templateId,
            assignedPrinterId: null,
            status: initialStatus,
            selectedColors,
            plateSpecificColors, 
            isCustomColor: isCustom,
            comments,
            etsyOrderId: orderMeta?.etsyOrderId?.trim() || undefined,
            etsyOrderedAt: orderMeta?.etsyOrderedAt,
            deadlineAt: orderMeta?.deadlineAt,
            deadlineMode: orderMeta?.deadlineMode,
            deadlineWorkdays: orderMeta?.deadlineWorkdays,
            usesExtendedHours: false,
            needsManualScheduling: false,
            createdAt: stamp,
            queueIndex: 9999,
            plateAssignments: initialAssignments
          };

          const allAssignments = Object.values(newOrder.plateAssignments);
          if (allAssignments.length > 0) {
              const allPrinted = allAssignments.every(a => a.status === OrderStatus.PRINTED);
              if (allPrinted && ![OrderStatus.ASSEMBLED, OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.STORED].includes(newOrder.status)) {
                  newOrder.status = OrderStatus.PRINTED;
              }
          }

          newOrders.push(newOrder);
        }

        setOrders(prev => [...prev, ...newOrders]);
        await Promise.all(newOrders.map(o => db.saveOrder(sanitizeOrder(o))));
    } finally {
        setIsGlobalProcessing(false);
    }
  };

  const handleUpdateOrder = async (orderId: string, updates: Partial<Order>) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const order = orders.find(o => o.id === orderId);
        if(order) {
            const updated = { ...order, ...updates };
            setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
            await db.saveOrder(sanitizeOrder(updated));
        }
    } finally {
        setIsGlobalProcessing(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (isGlobalProcessing) return;
    setIsGlobalProcessing(true);
    try {
        const order = orders.find(o => o.id === orderId);
        // Refund filament if any active assignments
        if (order) {
             let tempStock = [...filamentStock];
             let changed = false;
             Object.entries(order.plateAssignments || {}).forEach(([plateId, rawAssign]) => {
                 const assign = rawAssign as PlateAssignment;
                 if (assign.status === OrderStatus.ASSIGNED) {
                     tempStock = updateOrderFilament([order], orderId, plateId, 'REFUND', tempStock);
                     changed = true;
                 }
             });
             if (changed) {
                 await db.saveFilamentStock(tempStock);
                 setFilamentStock(tempStock);
             }
        }

        setOrders(prev => prev.filter(o => o.id !== orderId));
        await db.deleteOrder(orderId);
    } finally {
        setIsGlobalProcessing(false);
    }
  };

  const handleReorderQueue = async (sourceOrderId: string, targetOrderId: string) => {
     if (isGlobalProcessing) return;
     setIsGlobalProcessing(true);
     try {
         const newOrders = [...orders];
         const sourceIndex = newOrders.findIndex(o => o.id === sourceOrderId);
         const targetIndex = newOrders.findIndex(o => o.id === targetOrderId);
         if (sourceIndex === -1 || targetIndex === -1) return;
         const [movedOrder] = newOrders.splice(sourceIndex, 1);
         newOrders.splice(targetIndex, 0, movedOrder);
         
         const updatedWithIndices = newOrders.map((o, idx) => ({ ...o, queueIndex: idx }));
         setOrders(updatedWithIndices);
         
         await Promise.all(updatedWithIndices.map(o => db.saveOrder(sanitizeOrder(o))));
     } finally {
        setIsGlobalProcessing(false);
     }
  };

  const handleReorderPrinters = async (sourceId: string, targetId: string) => {
     if (isGlobalProcessing) return;
     setIsGlobalProcessing(true);
     try {
         const newPrinters = [...printers];
         const sourceIdx = newPrinters.findIndex(p => p.id === sourceId);
         const targetIdx = newPrinters.findIndex(p => p.id === targetId);
         if (sourceIdx === -1 || targetIdx === -1) return;
         
         const [moved] = newPrinters.splice(sourceIdx, 1);
         newPrinters.splice(targetIdx, 0, moved);
         
         // Update indices
         const updated = newPrinters.map((p, idx) => ({ ...p, orderIndex: idx }));
         setPrinters(updated);
         
         await Promise.all(updated.map(p => db.savePrinter(p)));
     } finally {
        setIsGlobalProcessing(false);
     }
  };

  // CRUD for Settings (Wrapped)
  const handleAddColor = async (name: string, hex: string, printerIds: string[]) => {
    if (isGlobalProcessing) return; setIsGlobalProcessing(true);
    try {
        const newColors = [...colors, { name, hex }];
        setColors(newColors);
        await db.saveColors(newColors);
        
        // Auto-add to filament stock if it doesn't exist
        const exists = filamentStock.some(f => f.color === name);
        if (!exists) {
           const newStock = [...filamentStock, { color: name, type: 'PLA', weightGrams: 0 }];
           setFilamentStock(newStock);
           await db.saveFilamentStock(newStock);
        }
    } finally { setIsGlobalProcessing(false); }
  };
  const handleDeleteColor = async (colorName: string) => {
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try {
          // 1. Remove from Color Definitions
          const newColors = colors.filter(c => c.name !== colorName);
          setColors(newColors);
          await db.saveColors(newColors);
      } finally { setIsGlobalProcessing(false); }
  };
  
  // Printers Local Update
  const handleAddPrinter = async (p: Printer) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setPrinters(prev => [...prev, p]);
        await db.savePrinter(p); 
      } finally { setIsGlobalProcessing(false); }
  };
  const handleUpdatePrinter = async (p: Printer) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setPrinters(prev => prev.map(pr => pr.id === p.id ? p : pr));
        await db.savePrinter(p); 
      } finally { setIsGlobalProcessing(false); }
  };
  const handleDeletePrinter = async (id: string) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setPrinters(prev => prev.filter(p => p.id !== id));
        await db.deletePrinter(id); 
      } finally { setIsGlobalProcessing(false); }
  };

  // Templates Local Update
  const handleAddTemplate = async (t: ProductTemplate) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setTemplates(prev => [...prev, t]);
        await db.saveTemplate(t); 
      } finally { setIsGlobalProcessing(false); }
  };
  const handleUpdateTemplate = async (t: ProductTemplate) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setTemplates(prev => prev.map(temp => temp.id === t.id ? t : temp));
        await db.saveTemplate(t); 
      } finally { setIsGlobalProcessing(false); }
  };
  const handleDeleteTemplate = async (id: string) => { 
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setTemplates(prev => prev.filter(t => t.id !== id));
        await db.deleteTemplate(id); 
      } finally { setIsGlobalProcessing(false); }
  };
  
  // NEW: Global Parts Management Local Update
  const handleSaveGlobalPart = async (part: Plate) => {
      if (isGlobalProcessing) return; setIsGlobalProcessing(true);
      try { 
        setGlobalParts(prev => {
           const existing = prev.findIndex(p => p.id === part.id);
           if (existing >= 0) {
             const copy = [...prev];
             copy[existing] = part;
             return copy;
           }
           return [...prev, part];
        });
        await db.savePart(part); 
      } finally { setIsGlobalProcessing(false); }
  };

  const handleImportData = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        setIsLoading(true);
        const json = JSON.parse(e.target?.result as string);
        await db.importData(json);
        window.location.reload(); 
      } catch (error) {
        alert('Ошибка импорта: Неверный формат файла или данные повреждены.');
        setIsLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleExportData = async () => {
    try {
      setIsLoading(true);
      const data = await db.exportData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `3d-farm-crm-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
    } catch (error) {
      console.error("Export error:", error);
      alert('Ошибка при экспорте данных');
    } finally {
      setIsLoading(false);
    }
  };

  // --- RENDER ---

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-500 gap-4">
        <Loader2 size={48} className="animate-spin text-indigo-600" />
        <p className="text-xl font-medium">Синхронизация данных...</p>
      </div>
    );
  }

  const queueCount = orders.filter(o => o.status !== OrderStatus.PRINTED && o.status !== OrderStatus.ASSEMBLED && o.status !== OrderStatus.PACKED && o.status !== OrderStatus.SHIPPED && o.status !== OrderStatus.STORED).length;
  const assemblyCount = orders.filter(o => o.status === OrderStatus.PRINTED).length;
  const packCount = orders.filter(o => o.status === OrderStatus.ASSEMBLED).length;

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans relative">
      {/* GLOBAL BLOCKING OVERLAY */}
      {(isGlobalProcessing || migrationStatus) && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center cursor-wait transition-opacity duration-200">
          <div className="bg-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in zoom-in duration-200 border border-slate-100">
             <Loader2 className="animate-spin text-indigo-600" size={32} />
             <span className="font-bold text-slate-700 text-lg">
                {migrationStatus ? migrationStatus : 'Сохранение...'}
             </span>
          </div>
        </div>
      )}

      <header className="bg-slate-900 text-white shadow-lg z-20 sticky top-0">
        <div className="flex items-center justify-between px-4 lg:px-6 h-16 sm:h-20">
          <div className="flex items-center gap-3">
             <div className="bg-indigo-600 p-2 rounded-lg">
                <LayoutGrid className="text-white w-6 h-6" />
             </div>
             <div>
                <h1 className="font-bold text-xl sm:text-2xl hidden lg:block tracking-wide leading-none">3D FARM CRM</h1>
                <div className="flex items-center gap-2">
                   {connectionError ? (
                     <span className="text-[10px] text-red-400 flex items-center gap-1 font-bold animate-pulse">
                        <CloudOff size={10} /> Нет соединения
                     </span>
                   ) : (
                     <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold">
                        <Wifi size={10} /> Онлайн
                     </span>
                   )}
                   {isSyncing ? (
                     <span className="text-[10px] text-slate-400 ml-2">Обновление...</span>
                   ) : (
                     <button onClick={() => loadData(false)} className="ml-2 text-slate-500 hover:text-white transition-colors" title="Синхронизировать сейчас">
                       <RefreshCw size={12} />
                     </button>
                   )}
                </div>
             </div>
          </div>

          <nav className="flex gap-1 sm:gap-2 h-full overflow-x-auto no-scrollbar">
             <TabButton 
               isActive={activeTab === 'ORDERS'} 
               onClick={() => setActiveTab('ORDERS')}
               icon={<PlusCircle size={24} />}
               label="Заказы"
             />
             <TabButton 
               isActive={activeTab === 'PRINTING'} 
               onClick={() => setActiveTab('PRINTING')}
               icon={<PrinterIcon size={24} />}
               label="Печать"
               badge={queueCount}
             />
             <TabButton 
               isActive={activeTab === 'ASSEMBLY'} 
               onClick={() => setActiveTab('ASSEMBLY')}
               icon={<Wrench size={24} />}
               label="Сборка"
               badge={assemblyCount}
             />
             <TabButton 
               isActive={activeTab === 'PACKING'} 
               onClick={() => setActiveTab('PACKING')}
               icon={<Package size={24} />}
               label="Упаковка"
               badge={packCount}
             />
             <TabButton 
               isActive={activeTab === 'STOCK'} 
               onClick={() => setActiveTab('STOCK')}
               icon={<Warehouse size={24} />}
               label="Склад"
             />
              <TabButton 
               isActive={activeTab === 'SETTINGS'} 
               onClick={() => setActiveTab('SETTINGS')}
               icon={<SettingsIcon size={24} />}
               label="Настройки"
             />
          </nav>
          
          <div className="ml-4 pl-4 border-l border-slate-700 hidden sm:flex items-center">
             <button 
               onClick={() => db.logout()}
               className="text-slate-400 hover:text-white p-2 rounded-lg transition-colors"
               title="Выйти"
             >
               <LogOut size={20} />
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative text-base sm:text-lg">
        {activeTab === 'ORDERS' && (
          <AddOrderTab 
            orders={orders}
            templates={templates} 
            printers={printers} 
            colors={colors}
            onAddOrder={handleAddOrder} 
            onUpdateOrder={handleUpdateOrder}
            onReorderQueue={handleReorderQueue}
            onDeleteOrder={handleDeleteOrder}
            onExport={handleExportData}
            onImport={handleImportData}
            stockItems={stockItems}
            onDecreaseStock={handleDecreaseStock}
          />
        )}
        
        {activeTab === 'PRINTING' && (
          <PrintingTab 
            orders={orders}
            printers={printers}
            templates={templates}
            colorDefs={colors}
            onMovePlate={handleMovePlate}
            onMoveBatch={handleMoveBatch}
            onSplitBatch={handleSplitBatch}
            onPlateStatusChange={handlePlateStatusChange}
            onAutoDistribute={handleAutoDistribute}
            onReorderPrinters={handleReorderPrinters}
            onClearDistribution={handleClearDistribution}
            onBatchComplete={handleBatchComplete}
            onAutoBatchAll={handleAutoBatchAll}
            onClearCompleted={handleClearCompleted}
            onMergeBatches={handleMergeBatches}
            onRevertBatch={handleRevertBatch}
          />
        )}

        {activeTab === 'ASSEMBLY' && (
          <AssemblyPackingTab 
            mode="ASSEMBLY"
            orders={orders}
            templates={templates}
            colorDefs={colors}
            onComplete={(id) => handleStatusChange(id, OrderStatus.ASSEMBLED)}
            onRevert={(id) => handleStatusChange(id, OrderStatus.PRINTED)}
            onMovePlate={handleMovePlate} // Added to allow reprint logic
          />
        )}

        {activeTab === 'PACKING' && (
          <AssemblyPackingTab 
            mode="PACKING"
            orders={orders}
            templates={templates}
            colorDefs={colors}
            onComplete={() => {}} 
            onSendToClient={(id) => handleStatusChange(id, OrderStatus.SHIPPED)}
            onSendToWarehouse={handleSendToWarehouse}
            onRevert={(id) => handleStatusChange(id, OrderStatus.ASSEMBLED)}
          />
        )}

        {activeTab === 'STOCK' && (
           <StockTab 
             stockItems={stockItems}
             templates={templates}
             colorDefs={colors}
             filamentStock={filamentStock}
             onDecreaseStock={handleDecreaseStock}
             onAddFilament={handleAddFilament}
             onDeleteFilament={handleDeleteFilament}
             onAddPartToStock={handleAddPartToStock}
           />
        )}

        {activeTab === 'SETTINGS' && (
          <div className="h-full overflow-y-auto">
            <SettingsTab
              colors={colors}
              printers={printers}
              templates={templates}
              globalParts={globalParts}
              wastePercentage={wastePercentage}
              onSaveWastePercentage={handleSaveSettings}
              onAddColor={handleAddColor}
              onDeleteColor={handleDeleteColor}
              onAddPrinter={handleAddPrinter}
              onUpdatePrinter={handleUpdatePrinter}
              onDeletePrinter={handleDeletePrinter}
              onAddTemplate={handleAddTemplate}
              onUpdateTemplate={handleUpdateTemplate}
              onDeleteTemplate={handleDeleteTemplate}
              onSaveGlobalPart={handleSaveGlobalPart}
              onExportData={handleExportData}
              onImportData={handleImportData}
            />
          </div>
        )}
      </main>
    </div>
  );
};

const TabButton: React.FC<{
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}> = ({ isActive, onClick, icon, label, badge }) => (
  <button 
    onClick={onClick}
    className={`
      relative flex items-center gap-2 px-3 sm:px-6 h-full transition-colors border-b-4 flex-shrink-0
      ${isActive 
        ? 'border-indigo-500 text-white bg-slate-800' 
        : 'border-transparent text-slate-400 hover:text-slate-200 hover:shadow-inner hover:bg-slate-800/50'}
    `}
  >
    {icon}
    <span className="text-base sm:text-lg font-medium hidden sm:inline-block">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className="absolute top-3 right-0 sm:right-1 bg-indigo-500 text-white text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center border border-slate-900 shadow-sm">
        {badge}
      </span>
    )}
  </button>
);

export default App;

