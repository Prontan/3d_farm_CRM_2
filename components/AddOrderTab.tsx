
import React, { useState, useRef, useEffect } from 'react';
import { ProductTemplate, Printer, Order, OrderStatus, ColorDef, StockItem, Plate, OrderCreateMeta } from '../types';
import { Search, Download, Upload, ChevronDown, Check, Plus, ArrowLeft, Trash2, GripVertical, Pencil, Layers, Clock, Palette, PaintBucket, AlertTriangle, Package, CheckCircle2 } from 'lucide-react';
import { OrderCard } from './OrderCard';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';
import {
  addWorkingDaysToDeadline,
  dateInputFromTimestampLA,
  dateTimeInputFromTimestampLA,
  formatDateTimeLA,
  nowInputDateTimeLA,
  parseDateAsLADeadline,
  parseDateTimeLocalAsLA
} from '../utils/deadlines';

interface Props {
  orders: Order[]; // Full list of orders to filter for queue
  templates: ProductTemplate[];
  printers: Printer[];
  colors: ColorDef[]; // Changed from availableColors: string[]
  stockItems: StockItem[]; // New: Check against stock
  onDecreaseStock: (itemId: string, amount: number) => void;
  onAddOrder: (
    templateId: string,
    colors: string[],
    comments: string,
    plateSpecificColors?: Record<string, string[]>,
    isCustom?: boolean,
    initialStatus?: OrderStatus,
    initialPlateStatuses?: Record<string, OrderStatus>,
    orderMeta?: OrderCreateMeta,
    quantity?: number
  ) => void;
  onUpdateOrder: (orderId: string, updates: Partial<Order>) => void;
  onReorderQueue: (sourceId: string, targetId: string) => void;
  onDeleteOrder: (orderId: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

// Helper to compare arrays ignoring order
const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, index) => val === sortedB[index]);
};

interface StockMatch {
   type: 'PRODUCT' | 'PART';
   stockItem: StockItem;
   plate?: Plate; // If Part
}

interface PendingOrderData {
  selectedTemplateId: string;
  summaryColors: string[];
  comments: string;
  plateSpecificColors: Record<string, string[]>;
  isCustom: boolean;
  orderMeta: OrderCreateMeta;
  quantity: number;
}

export const AddOrderTab: React.FC<Props> = ({ 
  orders,
  templates, 
  printers, 
  colors: availableColors,
  stockItems,
  onDecreaseStock,
  onAddOrder, 
  onUpdateOrder,
  onReorderQueue,
  onDeleteOrder,
  onExport,
  onImport
}) => {
  const [viewMode, setViewMode] = useState<'LIST' | 'CREATE'>('LIST');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Create/Edit Form State ---
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  
  const [plateSpecificColors, setPlateSpecificColors] = useState<Record<string, string[]>>({});
  const [comments, setComments] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [etsyOrderId, setEtsyOrderId] = useState('');
  const [etsyOrderedAtInput, setEtsyOrderedAtInput] = useState<string>(() => nowInputDateTimeLA());
  const [deadlineModeInput, setDeadlineModeInput] = useState<'WORKDAYS' | 'DATE'>('WORKDAYS');
  const [deadlineWorkdays, setDeadlineWorkdays] = useState(3);
  const [deadlineDateInput, setDeadlineDateInput] = useState<string>(() =>
    dateInputFromTimestampLA(addWorkingDaysToDeadline(Date.now(), 3))
  );
  const [quantity, setQuantity] = useState(1);
  
  // --- Stock Check State ---
  const [showStockModal, setShowStockModal] = useState(false);
  const [stockMatches, setStockMatches] = useState<StockMatch[]>([]);
  const [pendingOrderData, setPendingOrderData] = useState<PendingOrderData | null>(null); // To store form data while modal is open
  const [duplicateModalData, setDuplicateModalData] = useState<{
    etsyOrderId: string;
    duplicates: Order[];
    pending: PendingOrderData;
  } | null>(null);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const normalizeEtsyId = (value: string) => value.trim().toUpperCase();

  const buildOrderMeta = (): OrderCreateMeta | null => {
    const normalizedId = normalizeEtsyId(etsyOrderId);
    if (!normalizedId) {
      alert('Etsy Order ID is required.');
      return null;
    }

    const orderedAt = parseDateTimeLocalAsLA(etsyOrderedAtInput);
    if (!orderedAt) {
      alert('Invalid Etsy order date/time.');
      return null;
    }

    if (deadlineModeInput === 'WORKDAYS') {
      const workdays = Math.max(1, Math.floor(deadlineWorkdays || 1));
      const deadlineAt = addWorkingDaysToDeadline(orderedAt, workdays);
      return {
        etsyOrderId: normalizedId,
        etsyOrderedAt: orderedAt,
        deadlineAt,
        deadlineMode: workdays === 3 ? 'DEFAULT_WORKDAYS' : 'CUSTOM_WORKDAYS',
        deadlineWorkdays: workdays
      };
    }

    const customDeadlineAt = parseDateAsLADeadline(deadlineDateInput);
    if (!customDeadlineAt) {
      alert('Invalid custom deadline date.');
      return null;
    }

    return {
      etsyOrderId: normalizedId,
      etsyOrderedAt: orderedAt,
      deadlineAt: customDeadlineAt,
      deadlineMode: 'CUSTOM_DATE'
    };
  };

  // Filter for orders that are strictly in the queue (not assigned)
  const queuedOrders = orders
    .filter(o => o.status === OrderStatus.QUEUED && !o.assignedPrinterId)
    .sort((a, b) => (a.queueIndex || 0) - (b.queueIndex || 0));

  // --- Effects ---

  useEffect(() => {
    if (selectedTemplate) {
      if (editingOrderId) return; 

      const globalDefault = availableColors[0]?.name || 'Unknown';
      
      const initPlateColors: Record<string, string[]> = {};
      
      if (selectedTemplate.plates) {
        selectedTemplate.plates.forEach(p => {
          if (p.colors && p.colors.length > 0) {
            initPlateColors[p.id] = p.colors;
          } else if (selectedTemplate.defaultColors && selectedTemplate.defaultColors.length > 0) {
            initPlateColors[p.id] = [selectedTemplate.defaultColors[0]];
          } else {
            initPlateColors[p.id] = [globalDefault];
          }
        });
      }
      setPlateSpecificColors(initPlateColors);
    }
  }, [selectedTemplate, availableColors, editingOrderId]);

  useEffect(() => {
    if (deadlineModeInput !== 'WORKDAYS') return;
    const orderedAt = parseDateTimeLocalAsLA(etsyOrderedAtInput);
    if (!orderedAt) return;
    const computed = addWorkingDaysToDeadline(orderedAt, Math.max(1, Math.floor(deadlineWorkdays || 1)));
    setDeadlineDateInput(dateInputFromTimestampLA(computed));
  }, [deadlineModeInput, etsyOrderedAtInput, deadlineWorkdays]);


  const submitCreateOrder = (data: PendingOrderData) => {
    const { selectedTemplateId, summaryColors, comments, plateSpecificColors, isCustom, orderMeta, quantity } = data;
    const matches: StockMatch[] = [];

    const productMatch = stockItems.find(s => 
      s.type === 'PRODUCT' && 
      s.templateId === selectedTemplateId && 
      arraysEqual(s.colors, summaryColors) &&
      s.quantity > 0
    );
    if (productMatch) {
      matches.push({ type: 'PRODUCT', stockItem: productMatch });
    }

    const template = templates.find(t => t.id === selectedTemplateId);
    if (template?.plates) {
      template.plates.forEach(plate => {
        const pColors = plateSpecificColors[plate.id] || summaryColors;
        const partMatch = stockItems.find(s => {
          if (s.type !== 'PART' || s.quantity <= 0) return false;
          if (!arraysEqual(s.colors, pColors)) return false;
          if (s.plateId === plate.id) return true;

          const stockTmpl = templates.find(t => t.id === s.templateId);
          const stockPlate = stockTmpl?.plates?.find(p => p.id === s.plateId);
          if (stockPlate && stockPlate.name.trim().toLowerCase() === plate.name.trim().toLowerCase()) {
            return true;
          }

          return false;
        });

        if (partMatch) {
          matches.push({ type: 'PART', stockItem: partMatch, plate });
        }
      });
    }

    // Stock modal currently supports 1 order action.
    if (matches.length > 0 && quantity === 1) {
      setStockMatches(matches);
      setPendingOrderData(data);
      setShowStockModal(true);
    } else {
      onAddOrder(selectedTemplateId, summaryColors, comments, plateSpecificColors, isCustom, OrderStatus.QUEUED, {}, orderMeta, quantity);
      handleCancel();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId) return;

    let orderMeta: OrderCreateMeta | null = null;
    if (etsyOrderId.trim()) {
      orderMeta = buildOrderMeta();
      if (!orderMeta) return;
    } else if (!editingOrderId) {
      alert('Etsy Order ID is required for new orders.');
      return;
    }
    
    const usedColors = new Set<string>();
    (Object.values(plateSpecificColors) as string[][]).forEach(colors => {
      colors.forEach(c => usedColors.add(c));
    });
    const summaryColors = Array.from(usedColors);
    
    let isCustom = false;
    
    if (selectedTemplate?.plates) {
       for (const plate of selectedTemplate.plates) {
          const selectedForPlate = plateSpecificColors[plate.id] || [];
          
          if (plate.colors && plate.colors.length > 0) {
             if (!arraysEqual(selectedForPlate, plate.colors)) {
                isCustom = true;
             }
          } 
          else if (selectedTemplate.defaultColors && selectedTemplate.defaultColors.length > 0) {
             const primaryDefault = selectedTemplate.defaultColors[0];
             const isStandard = selectedForPlate.length === 1 && selectedForPlate[0] === primaryDefault;
             if (!isStandard) isCustom = true;
          }
       }
    }

    if (editingOrderId) {
      const metaUpdates = orderMeta ? {
        etsyOrderId: orderMeta.etsyOrderId,
        etsyOrderedAt: orderMeta.etsyOrderedAt,
        deadlineAt: orderMeta.deadlineAt,
        deadlineMode: orderMeta.deadlineMode,
        deadlineWorkdays: orderMeta.deadlineWorkdays,
        needsManualScheduling: false,
        usesExtendedHours: false
      } : {};

      onUpdateOrder(editingOrderId, {
        templateId: selectedTemplateId,
        selectedColors: summaryColors,
        plateSpecificColors,
        isCustomColor: isCustom,
        comments,
        ...metaUpdates
      });
      handleCancel();
      return;
    }

    if (!orderMeta) {
      alert('Etsy metadata is required for new orders.');
      return;
    }

    const data: PendingOrderData = {
      selectedTemplateId,
      summaryColors,
      comments,
      plateSpecificColors,
      isCustom,
      orderMeta,
      quantity: Math.max(1, Math.floor(quantity || 1))
    };

    const duplicateOrders = orders.filter(o => normalizeEtsyId(o.etsyOrderId || '') === orderMeta.etsyOrderId);
    if (duplicateOrders.length > 0) {
      setDuplicateModalData({
        etsyOrderId: orderMeta.etsyOrderId,
        duplicates: duplicateOrders,
        pending: data
      });
      return;
    }

    submitCreateOrder(data);
  };

  const handleDuplicateAction = (action: 'OPEN' | 'CREATE' | 'UPDATE' | 'CANCEL') => {
    const modal = duplicateModalData;
    if (!modal) return;
    const { duplicates, pending } = modal;
    setDuplicateModalData(null);

    if (action === 'CANCEL') {
      return;
    }

    if (action === 'OPEN') {
      const target = duplicates.find(o => o.status === OrderStatus.QUEUED && !o.assignedPrinterId) || duplicates[0];
      if (target.status === OrderStatus.QUEUED && !target.assignedPrinterId) {
        handleEditStart(target);
      } else {
        setViewMode('LIST');
        alert(`Existing order found in status: ${target.status}`);
      }
      return;
    }

    if (action === 'UPDATE') {
      const target = duplicates.find(o => o.status === OrderStatus.QUEUED && !o.assignedPrinterId) || duplicates[0];
      onUpdateOrder(target.id, {
        templateId: pending.selectedTemplateId,
        selectedColors: pending.summaryColors,
        plateSpecificColors: pending.plateSpecificColors,
        isCustomColor: pending.isCustom,
        comments: pending.comments,
        etsyOrderId: pending.orderMeta.etsyOrderId,
        etsyOrderedAt: pending.orderMeta.etsyOrderedAt,
        deadlineAt: pending.orderMeta.deadlineAt,
        deadlineMode: pending.orderMeta.deadlineMode,
        deadlineWorkdays: pending.orderMeta.deadlineWorkdays,
        needsManualScheduling: false,
        usesExtendedHours: false
      });

      if (pending.quantity > 1) {
        onAddOrder(
          pending.selectedTemplateId,
          pending.summaryColors,
          pending.comments,
          pending.plateSpecificColors,
          pending.isCustom,
          OrderStatus.QUEUED,
          {},
          pending.orderMeta,
          pending.quantity - 1
        );
      }

      handleCancel();
      return;
    }

    submitCreateOrder(pending);
  };

  const handleConfirmStockUse = (useProduct: boolean, useParts: string[]) => {
      if (!pendingOrderData) return;
      const { selectedTemplateId, summaryColors, comments, plateSpecificColors, isCustom, orderMeta, quantity } = pendingOrderData;
      
      let initialStatus = OrderStatus.QUEUED;
      let initialPlateStatuses: Record<string, OrderStatus> = {};

      // Option 1: Use Full Product
      if (useProduct) {
         const match = stockMatches.find(m => m.type === 'PRODUCT');
         if (match) {
             // Deduct stock
             onDecreaseStock(match.stockItem.id, 1);
             // Set status to ASSEMBLED (Goes to Packing)
             initialStatus = OrderStatus.ASSEMBLED;
         }
      } 
      // Option 2: Use Parts
      else if (useParts.length > 0) {
         useParts.forEach(plateId => {
             // Find match by ID or Name logic used in search
             const match = stockMatches.find(m => m.type === 'PART' && m.plate?.id === plateId);
             if (match) {
                 onDecreaseStock(match.stockItem.id, 1);
                 initialPlateStatuses[plateId] = OrderStatus.PRINTED;
             }
         });

         // --- BUGFIX: Check if ALL parts are covered ---
         const tmpl = templates.find(t => t.id === selectedTemplateId);
         if (tmpl && tmpl.plates) {
             // If the number of parts used from stock equals the total number of plates in template
             if (useParts.length === tmpl.plates.length) {
                 initialStatus = OrderStatus.PRINTED; // Skip queue entirely
             }
         }
      }

      onAddOrder(
        selectedTemplateId,
        summaryColors,
        comments,
        plateSpecificColors,
        isCustom,
        initialStatus,
        initialPlateStatuses,
        orderMeta,
        quantity
      );
      
      setShowStockModal(false);
      setPendingOrderData(null);
      setStockMatches([]);
      handleCancel();
  };

  const handleEditStart = (order: Order) => {
    setEditingOrderId(order.id);
    setSelectedTemplateId(order.templateId);
    setComments(order.comments || '');
    setEtsyOrderId(order.etsyOrderId || '');
    setEtsyOrderedAtInput(order.etsyOrderedAt ? dateTimeInputFromTimestampLA(order.etsyOrderedAt) : nowInputDateTimeLA());
    setDeadlineModeInput(order.deadlineMode === 'CUSTOM_DATE' ? 'DATE' : 'WORKDAYS');
    setDeadlineWorkdays(order.deadlineWorkdays || 3);
    setDeadlineDateInput(
      order.deadlineAt
        ? dateInputFromTimestampLA(order.deadlineAt)
        : dateInputFromTimestampLA(addWorkingDaysToDeadline(order.etsyOrderedAt || Date.now(), order.deadlineWorkdays || 3))
    );
    setQuantity(1);
    
    if (order.plateSpecificColors) {
      setPlateSpecificColors(order.plateSpecificColors);
    } else {
       const tmpl = templates.find(t => t.id === order.templateId);
       const init: Record<string, string[]> = {};
       tmpl?.plates?.forEach(p => {
          init[p.id] = order.selectedColors;
       });
       setPlateSpecificColors(init);
    }
    
    setViewMode('CREATE'); 
  };

  const handleCancel = () => {
    setViewMode('LIST');
    setEditingOrderId(null);
    setComments('');
    setSelectedTemplateId(null);
    setPlateSpecificColors({});
    setEtsyOrderId('');
    const nowInput = nowInputDateTimeLA();
    setEtsyOrderedAtInput(nowInput);
    setDeadlineModeInput('WORKDAYS');
    setDeadlineWorkdays(3);
    const parsedNow = parseDateTimeLocalAsLA(nowInput) || Date.now();
    setDeadlineDateInput(dateInputFromTimestampLA(addWorkingDaysToDeadline(parsedNow, 3)));
    setQuantity(1);
    setPendingOrderData(null);
    setDuplicateModalData(null);
    setShowStockModal(false);
    setStockMatches([]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const applyColorToAll = (color: string) => {
     if (!selectedTemplate?.plates) return;
     
     const newMap = { ...plateSpecificColors };
     selectedTemplate.plates.forEach(p => {
        newMap[p.id] = [color];
     });
     setPlateSpecificColors(newMap);
  };

  const togglePlateColor = (plateId: string, color: string) => {
    const current = plateSpecificColors[plateId] || [];
    let newColors: string[] = [];
    
    if (current.includes(color)) {
       if (current.length <= 1) return;
       newColors = current.filter(c => c !== color);
    } else {
       newColors = [...current, color];
    }
    
    setPlateSpecificColors({
      ...plateSpecificColors,
      [plateId]: newColors
    });
  };

  const filteredTemplates = templates.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const previewOrderedAtTs = parseDateTimeLocalAsLA(etsyOrderedAtInput);
  const previewDeadlineTs = deadlineModeInput === 'WORKDAYS'
    ? (previewOrderedAtTs ? addWorkingDaysToDeadline(previewOrderedAtTs, Math.max(1, Math.floor(deadlineWorkdays || 1))) : null)
    : parseDateAsLADeadline(deadlineDateInput);

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    e.dataTransfer.setData('reorderOrderId', orderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetOrderId: string) => {
    e.preventDefault();
    const sourceOrderId = e.dataTransfer.getData('reorderOrderId');
    
    if (sourceOrderId && sourceOrderId !== targetOrderId) {
      onReorderQueue(sourceOrderId, targetOrderId);
    }
  };

  // --- Modal Subcomponent Logic ---
  const StockModal = () => {
     const productMatch = stockMatches.find(m => m.type === 'PRODUCT');
     const partMatches = stockMatches.filter(m => m.type === 'PART');
     
     const [useProduct, setUseProduct] = useState(!!productMatch);
     const [selectedParts, setSelectedParts] = useState<string[]>(partMatches.map(m => m.plate!.id)); // Default select all found parts

     return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => {}}>
           <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in fade-in zoom-in duration-200">
               <div className="flex items-center gap-3 mb-4 text-emerald-600">
                   <Package size={32} />
                   <h3 className="text-xl font-bold text-slate-800">Найдено на складе</h3>
               </div>
               
               <p className="text-slate-500 text-sm mb-6">
                  Для этого заказа есть готовые позиции на складе. Вы хотите использовать их, чтобы пропустить этапы производства?
               </p>

               <div className="space-y-4 mb-8">
                   {/* Product Option */}
                   {productMatch && (
                       <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${useProduct ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                           <input 
                             type="radio" 
                             checked={useProduct} 
                             onChange={() => { setUseProduct(true); setSelectedParts([]); }}
                             className="mt-1 w-5 h-5 text-emerald-600 focus:ring-emerald-500"
                           />
                           <div>
                               <div className="font-bold text-slate-800 flex items-center gap-2">
                                  Готовое изделие 
                                  <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">x{productMatch.stockItem.quantity}</span>
                               </div>
                               <div className="text-xs text-slate-500 mt-1">
                                  Сразу отправить на упаковку (пропустить печать и сборку).
                               </div>
                           </div>
                       </label>
                   )}

                   {/* Parts Option */}
                   {partMatches.length > 0 && (
                       <div className={`rounded-xl border-2 transition-all overflow-hidden ${!useProduct && selectedParts.length > 0 ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                           <div className="p-4 border-b border-slate-200/50" onClick={() => { if(useProduct) setUseProduct(false); }}>
                               <div className="font-bold text-slate-800 mb-1">Отдельные детали</div>
                               <div className="text-xs text-slate-500">Пометить как "Напечатано".</div>
                           </div>
                           <div className="p-2 space-y-1 bg-white/50">
                               {partMatches.map(m => (
                                   <label key={m.plate!.id} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer">
                                       <input 
                                         type="checkbox" 
                                         checked={selectedParts.includes(m.plate!.id) && !useProduct}
                                         onChange={(e) => {
                                            setUseProduct(false);
                                            if (e.target.checked) {
                                                setSelectedParts(prev => [...prev, m.plate!.id]);
                                            } else {
                                                setSelectedParts(prev => prev.filter(id => id !== m.plate!.id));
                                            }
                                         }}
                                         className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                       />
                                       <span className="text-sm font-medium text-slate-700 flex-1">{m.plate!.name}</span>
                                       <span className="text-xs font-bold text-slate-400">В наличии: {m.stockItem.quantity}</span>
                                   </label>
                               ))}
                           </div>
                       </div>
                   )}
               </div>

               <div className="flex gap-3">
                  <button 
                     onClick={() => handleConfirmStockUse(false, [])} // Skip stock use
                     className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors text-sm"
                  >
                     Печатать всё
                  </button>
                  <button 
                     onClick={() => handleConfirmStockUse(useProduct, selectedParts)}
                     className="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                  >
                     <CheckCircle2 size={18} />
                     Использовать
                  </button>
               </div>
           </div>
        </div>
     );
  };

  const DuplicateModal = () => {
    if (!duplicateModalData) return null;
    const { etsyOrderId, duplicates } = duplicateModalData;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg animate-in fade-in zoom-in duration-200">
          <div className="flex items-center gap-3 mb-3 text-amber-600">
            <AlertTriangle size={28} />
            <h3 className="text-xl font-bold text-slate-800">Duplicate Etsy Order ID</h3>
          </div>
          <p className="text-slate-600 text-sm mb-4">
            Etsy ID <span className="font-bold">#{etsyOrderId}</span> already exists ({duplicates.length} order(s)).
          </p>
          <p className="text-xs text-slate-500 mb-6">
            Choose what to do. Recommended default: open existing order.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleDuplicateAction('OPEN')}
              className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              Open Existing (Default)
            </button>
            <button
              type="button"
              onClick={() => handleDuplicateAction('UPDATE')}
              className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold"
            >
              Update Existing
            </button>
            <button
              type="button"
              onClick={() => handleDuplicateAction('CREATE')}
              className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              Create Duplicate
            </button>
            <button
              type="button"
              onClick={() => handleDuplicateAction('CANCEL')}
              className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };


  if (viewMode === 'CREATE') {
    return (
      <div className="max-w-7xl mx-auto p-4 sm:p-8 h-full flex flex-col relative">
        {showStockModal && <StockModal />}
        {duplicateModalData && <DuplicateModal />}
        
        <div className="flex items-center gap-4 mb-6">
          <button 
            onClick={handleCancel}
            className="p-3 hover:bg-slate-200 rounded-full transition-colors"
          >
            <ArrowLeft size={32} />
          </button>
          <h2 className="text-3xl font-bold text-slate-800">
            {editingOrderId ? 'Редактировать заказ' : 'Создание заказа'}
          </h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0">
          <div className="flex-1 bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-0">
             <div className="flex justify-between items-center mb-6 flex-shrink-0">
               <h3 className="font-bold text-xl sm:text-2xl text-slate-800">1. Выберите товар</h3>
               <div className="relative w-1/2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                  <input 
                    type="text" 
                    placeholder="Поиск..." 
                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
               </div>
             </div>

             <div className="grid grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto p-1 pr-2 no-scrollbar">
                {filteredTemplates.map(t => (
                  <div 
                    key={t.id}
                    onClick={() => setSelectedTemplateId(t.id)}
                    className={`
                      cursor-pointer rounded-xl border-2 p-3 hover:shadow-lg transition-all
                      ${selectedTemplateId === t.id ? 'border-indigo-500 ring-2 ring-indigo-100 bg-indigo-50' : 'border-slate-200 bg-white'}
                    `}
                  >
                    <img src={t.photoUrl} className="w-full h-40 object-cover rounded-lg mb-3 bg-slate-100" alt={t.name}/>
                    <p className="font-bold text-lg text-center leading-tight">{t.name}</p>
                    {t.plates && t.plates.length > 0 && (
                      <p className="text-xs text-center text-slate-400 font-medium mt-1">{t.plates.length} детали</p>
                    )}
                  </div>
                ))}
             </div>
          </div>

          <div className="w-full lg:w-1/3 flex flex-col min-h-0">
             <form onSubmit={handleSubmit} className={`bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col overflow-y-auto ${!selectedTemplateId ? 'opacity-50 pointer-events-none' : ''}`}>
                <h3 className="font-bold text-xl sm:text-2xl mb-6 text-slate-800 flex-shrink-0">2. Детали заказа</h3>
                
                {selectedTemplate ? (
                  <>
                     <div className="flex gap-5 mb-6 pb-6 border-b border-slate-100 flex-shrink-0">
                       <img src={selectedTemplate.photoUrl} className="w-24 h-24 rounded-lg object-cover bg-slate-100 shadow-sm" alt=""/>
                       <div className="flex-1">
                         <h4 className="font-bold text-xl text-slate-800 leading-tight">{selectedTemplate.name}</h4>
                         <div className="flex items-center gap-4 mt-2">
                             <div className="text-base text-slate-500 flex items-center gap-1.5">
                                <Clock size={16} /> {selectedTemplate.printTimeMinutes} мин
                             </div>
                             {selectedTemplate.plates && selectedTemplate.plates.length > 0 && (
                                <div className="text-base text-indigo-600 font-bold flex items-center gap-1.5">
                                   <Layers size={16} /> {selectedTemplate.plates.length}
                                </div>
                             )}
                         </div>
                       </div>
                     </div>
                    
                     <div className="space-y-8 flex-1">
                        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                          <h4 className="font-bold text-slate-700 mb-3 uppercase text-xs tracking-wider">Etsy Deadline</h4>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1">Etsy Order ID *</label>
                              <input
                                type="text"
                                value={etsyOrderId}
                                onChange={e => setEtsyOrderId(e.target.value)}
                                placeholder="e.g. 1234567890"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                required
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1">Etsy Order Date/Time (LA)</label>
                              <input
                                type="datetime-local"
                                value={etsyOrderedAtInput}
                                onChange={e => setEtsyOrderedAtInput(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                required
                              />
                            </div>

                            {!editingOrderId && (
                              <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Quantity</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={quantity}
                                  onChange={e => setQuantity(Math.max(1, Number(e.target.value || 1)))}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setDeadlineModeInput('WORKDAYS')}
                                className={`py-2 rounded-lg font-bold text-sm border ${deadlineModeInput === 'WORKDAYS' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300'}`}
                              >
                                Workdays
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeadlineModeInput('DATE')}
                                className={`py-2 rounded-lg font-bold text-sm border ${deadlineModeInput === 'DATE' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300'}`}
                              >
                                Exact Date
                              </button>
                            </div>

                            {deadlineModeInput === 'WORKDAYS' ? (
                              <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Workdays (Mon-Sat)</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={deadlineWorkdays}
                                  onChange={e => setDeadlineWorkdays(Math.max(1, Number(e.target.value || 1)))}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                              </div>
                            ) : (
                              <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Deadline Date (time fixed to 16:00 LA)</label>
                                <input
                                  type="date"
                                  value={deadlineDateInput}
                                  onChange={e => setDeadlineDateInput(e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                  required
                                />
                              </div>
                            )}

                            <div className="text-xs rounded-lg px-3 py-2 border border-slate-200 bg-white text-slate-600">
                              Calculated deadline: <span className="font-bold text-slate-800">{previewDeadlineTs ? formatDateTimeLA(previewDeadlineTs) : 'Invalid'}</span> (LA, 16:00 ship cutoff)
                            </div>
                          </div>
                        </div>

                        {selectedTemplate.plates && selectedTemplate.plates.length > 0 && (
                           <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                             <div className="flex justify-between items-center mb-4">
                               <h4 className="font-bold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                                 <Palette size={16} />
                                 Настройка деталей
                               </h4>
                             </div>
                             
                             {/* Quick Select All Toolbar */}
                             <div className="mb-4 overflow-x-auto no-scrollbar pb-2">
                               <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Применить ко всем:</p>
                               <div className="flex gap-2">
                                  {availableColors.map(c => {
                                    const hex = c.hex;
                                    const isLight = isLightColor(hex);
                                    return (
                                    <button
                                      key={`all-${c.name}`}
                                      type="button"
                                      onClick={() => applyColorToAll(c.name)}
                                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg border shadow-sm transition-transform active:scale-95 whitespace-nowrap"
                                      style={{ backgroundColor: hex, borderColor: isLight ? '#cbd5e1' : hex }}
                                      title={c.name}
                                    >
                                      <div className={`text-[10px] font-bold uppercase ${isLight ? 'text-slate-800' : 'text-white'}`}>
                                        {c.name}
                                      </div>
                                    </button>
                                  )})}
                               </div>
                             </div>

                             <div className="space-y-4">
                               {selectedTemplate.plates.map((plate) => {
                                 const myColors = plateSpecificColors[plate.id] || [];
                                 
                                 return (
                                   <div key={plate.id} className="flex flex-col gap-2 border-b border-slate-200 last:border-0 pb-4 last:pb-0">
                                     <div className="flex justify-between items-center">
                                       <span className="font-bold text-slate-700 text-sm">{plate.name}</span>
                                       <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                                          {myColors.map(cName => {
                                            const hex = resolveColorHex(cName, availableColors);
                                            const isLight = isLightColor(hex);
                                            return (
                                            <span 
                                              key={cName} 
                                              className="text-xs font-bold px-1.5 py-0.5 rounded border shadow-sm flex items-center gap-1"
                                              style={{
                                                backgroundColor: hex,
                                                color: getTextColor(hex),
                                                borderColor: isLight ? '#cbd5e1' : hex
                                              }}
                                            >
                                              {cName}
                                            </span>
                                          )})}
                                          {myColors.length === 0 && <span className="text-xs text-red-500 font-bold">Не выбрано</span>}
                                       </div>
                                     </div>
                                     
                                     {/* Horizontal Color List for Plate */}
                                     <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 pt-1">
                                         {availableColors.map(colorDef => {
                                            const isActive = myColors.includes(colorDef.name);
                                            const isRecommended = plate.colors?.includes(colorDef.name);
                                            const hex = colorDef.hex;
                                            const isLight = isLightColor(hex);

                                            return (
                                              <button
                                                key={colorDef.name}
                                                type="button"
                                                onClick={() => togglePlateColor(plate.id, colorDef.name)}
                                                className={`
                                                  flex-shrink-0 w-8 h-8 rounded-full border-2 transition-all relative shadow-sm
                                                  ${isActive
                                                     ? 'ring-2 ring-indigo-500 ring-offset-2 scale-110'
                                                     : 'hover:scale-105 opacity-80 hover:opacity-100'}
                                                `}
                                                style={{ backgroundColor: hex, borderColor: isActive ? (isLight ? '#94a3b8' : 'transparent') : '#e2e8f0' }}
                                                title={colorDef.name}
                                              >
                                                {isActive && (
                                                   <span className={`absolute inset-0 flex items-center justify-center ${isLight ? 'text-slate-800' : 'text-white'}`}>
                                                      <Check size={14} strokeWidth={3} />
                                                   </span>
                                                )}
                                                {isRecommended && !isActive && (
                                                   <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500 border border-white"></span>
                                                   </span>
                                                )}
                                              </button>
                                            )
                                         })}
                                       </div>
                                   </div>
                                 );
                               })}
                             </div>
                           </div>
                        )}

                        <div>
                          <label className="block text-xl font-bold text-slate-700 mb-2">Комментарий</label>
                          <textarea 
                            value={comments}
                            onChange={e => setComments(e.target.value)}
                            className="w-full p-4 border border-slate-300 rounded-xl text-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none min-h-[100px] bg-white"
                            placeholder="Особые требования..."
                          />
                        </div>
                     </div>

                     <div className="flex gap-4 mt-8 flex-shrink-0">
                       <button 
                         type="button"
                         onClick={handleCancel}
                         className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xl py-5 rounded-xl transition-all"
                       >
                         Отмена
                       </button>
                       <button 
                         type="submit"
                         className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xl py-5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-indigo-200"
                       >
                         {editingOrderId ? 'Сохранить' : 'Добавить'}
                       </button>
                     </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-lg text-center px-4">
                    Выберите товар слева
                  </div>
                )}
             </form>
          </div>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8 h-full flex flex-col">
       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <h2 className="text-3xl font-bold text-slate-800">Очередь заказов</h2>
        
        <div className="flex items-center gap-3">
           <button 
            onClick={() => {
              setEditingOrderId(null);
              setSelectedTemplateId(null);
              setComments('');
              setPlateSpecificColors({});
              setEtsyOrderId('');
              const nowInput = nowInputDateTimeLA();
              setEtsyOrderedAtInput(nowInput);
              setDeadlineModeInput('WORKDAYS');
              setDeadlineWorkdays(3);
              const parsedNow = parseDateTimeLocalAsLA(nowInput) || Date.now();
              setDeadlineDateInput(dateInputFromTimestampLA(addWorkingDaysToDeadline(parsedNow, 3)));
              setQuantity(1);
              setViewMode('CREATE');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-bold transition-all shadow-md text-lg"
          >
            <Plus size={24} />
            Новый заказ
          </button>
          <div className="w-px h-8 bg-slate-300 mx-2 hidden sm:block"></div>
          <button 
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium transition-colors text-lg"
          >
            <Download size={22} />
            Экспорт
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium transition-colors text-lg"
          >
            <Upload size={22} />
            Импорт
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".json" 
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        {queuedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
             <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                <Plus size={40} />
             </div>
             <p className="text-2xl font-medium">Очередь пуста</p>
             <p className="text-lg mt-2">Нажмите "Новый заказ", чтобы добавить</p>
          </div>
        ) : (
          <div className="space-y-4">
            {queuedOrders.map((order, index) => {
               const tmpl = templates.find(t => t.id === order.templateId);
               if (!tmpl) return null;

               return (
                 <div 
                   key={order.id}
                   draggable
                   onDragStart={(e) => handleDragStart(e, order.id)}
                   onDragOver={handleDragOver}
                   onDrop={(e) => handleDrop(e, order.id)}
                   className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-300 transition-all group select-none"
                 >
                   <div className="text-slate-300 cursor-grab active:cursor-grabbing p-2">
                      <GripVertical size={24} />
                   </div>
                   
                   <div className="font-bold text-2xl text-slate-300 w-10 text-center">
                     {index + 1}
                   </div>

                   <div className="flex-1 pointer-events-none">
                      <OrderCard 
                        order={order}
                        template={tmpl}
                        compact
                        colorDefs={availableColors}
                      />
                   </div>

                   <div className="flex flex-col gap-2">
                      <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         handleEditStart(order);
                       }}
                       onMouseDown={(e) => e.stopPropagation()}
                       onTouchStart={(e) => e.stopPropagation()}
                       className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                       title="Редактировать"
                     >
                       <Pencil size={24} />
                     </button>
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         onDeleteOrder(order.id);
                       }}
                       onMouseDown={(e) => e.stopPropagation()}
                       onTouchStart={(e) => e.stopPropagation()}
                       className="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                       title="Удалить из очереди"
                     >
                       <Trash2 size={24} />
                     </button>
                   </div>
                 </div>
               );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
