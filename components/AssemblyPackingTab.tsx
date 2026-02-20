
import React, { useState, useMemo } from 'react';
import { Order, ProductTemplate, OrderStatus, ColorDef, PlateAssignment } from '../types';
import { Clock, Box, ArrowRight, History, RotateCcw, ChevronRight, ChevronLeft, CheckCircle2, Printer, Warehouse, Truck, AlertCircle, RefreshCw } from 'lucide-react';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';

interface Props {
  mode: 'ASSEMBLY' | 'PACKING';
  orders: Order[];
  templates: ProductTemplate[];
  colorDefs: ColorDef[];
  onComplete: (orderId: string) => void; // Used for Assembly
  onSendToClient?: (orderId: string) => void; // Used for Packing
  onSendToWarehouse?: (orderId: string) => void; // Used for Packing
  onRevert?: (orderId: string) => void;
  onMovePlate?: (orderId: string, plateId: string, targetPrinterId: string | null) => void; // New prop for requeue
}

export const AssemblyPackingTab: React.FC<Props> = ({ 
  mode, 
  orders, 
  templates,
  colorDefs,
  onComplete, 
  onSendToClient, 
  onSendToWarehouse,
  onRevert,
  onMovePlate
}) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  const isAssembly = mode === 'ASSEMBLY';
  
  // History Status: Assembled for Assembly tab, Shipped for Packing tab
  const historyStatus = isAssembly ? OrderStatus.ASSEMBLED : OrderStatus.SHIPPED;
  
  // 1. Filter Logic
  const activeOrders = useMemo(() => {
    return orders.filter(o => {
      if (isAssembly) {
        return (
          o.status === OrderStatus.QUEUED || 
          o.status === OrderStatus.ASSIGNED || 
          o.status === OrderStatus.PRINTED
        );
      } else {
        return o.status === OrderStatus.ASSEMBLED;
      }
    }).sort((a, b) => {
      // Sort priority: Ready items first
      if (isAssembly) {
        const aReady = a.status === OrderStatus.PRINTED;
        const bReady = b.status === OrderStatus.PRINTED;
        if (aReady && !bReady) return -1;
        if (!aReady && bReady) return 1;
      }
      return (a.queueIndex || 0) - (b.queueIndex || 0);
    });
  }, [orders, isAssembly]);

  // Filter history (recently completed)
  const historyOrders = orders
    .filter(o => o.status === historyStatus)
    .reverse();

  // Calculate Total Time (Includes future work for assembly)
  const totalMinutes = activeOrders.reduce((acc, o) => {
    const t = templates.find(temp => temp.id === o.templateId);
    if (!t) return acc;
    return acc + (isAssembly ? t.assemblyTimeMinutes : t.packingTimeMinutes);
  }, 0);

  const formatTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}ч ${m}м`;
  };

  // Helper to calculate print progress %
  const getPrintProgress = (order: Order, template: ProductTemplate) => {
    if (order.status === OrderStatus.PRINTED) return 100;
    if (!template.plates || template.plates.length === 0) return 0;

    let printedCount = 0;
    template.plates.forEach(p => {
       const assignment = order.plateAssignments?.[p.id];
       if (assignment && assignment.status === OrderStatus.PRINTED) {
         printedCount++;
       }
    });
    return Math.round((printedCount / template.plates.length) * 100);
  };

  const handleRequeuePlate = (e: React.MouseEvent, orderId: string, plateId: string, plateName: string) => {
    e.stopPropagation();
    if (!onMovePlate) return;
    
    // Direct action without confirm for better UX
    onMovePlate(orderId, plateId, null);
  };

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden relative">
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden transition-all duration-300">
        {/* Top Stats Bar */}
        <div className="bg-white border-b border-slate-200 px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between sticky top-0 z-10 gap-4 flex-shrink-0">
          <div>
            <h2 className="text-3xl font-bold text-slate-800">{isAssembly ? 'Сборка' : 'Упаковка'}</h2>
            <p className="text-slate-500 text-lg mt-1">
              {activeOrders.length} заказов в очереди
            </p>
          </div>
          
          <div className="flex items-center gap-5 bg-indigo-50 px-6 py-4 rounded-2xl border border-indigo-100 shadow-sm w-full sm:w-auto">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
              <Clock size={32} />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-bold uppercase tracking-wider opacity-80">
                Общее время
              </p>
              <p className="text-3xl font-extrabold text-indigo-900 leading-none mt-1">
                {formatTime(totalMinutes)}
              </p>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <Box size={64} className="mb-6 opacity-30" />
              <p className="text-2xl font-medium">Нет заказов для {isAssembly ? 'сборки' : 'упаковки'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {activeOrders.map(order => {
                const tmpl = templates.find(t => t.id === order.templateId)!;
                const hasComment = order.comments && order.comments.trim().length > 0;
                
                // Determine if the card is ready for action
                const isReady = isAssembly ? order.status === OrderStatus.PRINTED : true;
                const progress = isAssembly ? getPrintProgress(order, tmpl) : 100;
                
                // Get all plates sorted: Missing/Printing first, Done last
                const allPlates = tmpl.plates || [];
                const sortedPlates = [...allPlates].sort((a, b) => {
                    const assignA = order.plateAssignments?.[a.id];
                    const assignB = order.plateAssignments?.[b.id];
                    
                    const isDoneA = assignA?.status === OrderStatus.PRINTED;
                    const isDoneB = assignB?.status === OrderStatus.PRINTED;
                    
                    if (isDoneA && !isDoneB) return 1;
                    if (!isDoneA && isDoneB) return -1;
                    return 0;
                });
                
                const printedCount = allPlates.filter(p => order.plateAssignments?.[p.id]?.status === OrderStatus.PRINTED).length;

                return (
                  <div 
                    key={order.id} 
                    className={`
                      relative rounded-2xl shadow-sm border p-5 flex flex-col justify-between transition-all
                      ${isReady 
                        ? 'bg-white border-slate-200 hover:shadow-md' 
                        : 'bg-slate-50 border-slate-200'}
                      ${hasComment && isReady ? 'border-amber-400 ring-2 ring-amber-100' : ''}
                    `}
                  >
                    {!isReady && (
                      <div className="absolute top-4 right-4 z-10">
                        <span className="bg-white/80 backdrop-blur text-indigo-600 border border-indigo-100 text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                           <Printer size={12} /> В печати
                        </span>
                      </div>
                    )}

                    <div className={`flex gap-5 ${!isReady ? '' : ''}`}>
                      <div className="relative">
                        <img src={tmpl.photoUrl} className={`w-20 h-20 bg-slate-100 rounded-xl object-cover shadow-sm ${!isReady ? 'grayscale opacity-80' : ''}`} alt="" />
                        {!isReady && (
                           <div className="absolute inset-0 flex items-center justify-center">
                              <div className="bg-slate-900/10 backdrop-blur-[1px] rounded-xl inset-0 absolute" />
                           </div>
                        )}
                      </div>
                      
                      <div className="min-w-0 flex-1">
                         <h3 className="font-bold text-xl text-slate-800 leading-tight line-clamp-2">{tmpl.name}</h3>
                         <div className="mt-2 flex flex-wrap gap-1.5">
                           {order.selectedColors.map(c => {
                             const hex = resolveColorHex(c, colorDefs);
                             const isLight = isLightColor(hex);
                             return (
                             <span 
                                key={c} 
                                className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide px-2 py-1 rounded border shadow-sm"
                                style={{
                                  backgroundColor: hex,
                                  color: getTextColor(hex),
                                  borderColor: isLight ? '#cbd5e1' : hex
                                }}
                              >
                               {c}
                             </span>
                           )})}
                         </div>
                      </div>
                    </div>

                    {hasComment && (
                      <div className={`mt-4 p-3 rounded-lg text-sm font-bold border shadow-sm flex items-start gap-2 ${isReady ? 'bg-amber-100 text-amber-900 border-amber-200' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <span>{order.comments}</span>
                      </div>
                    )}

                    {!isAssembly && (
                       <div className="mt-4 bg-blue-50 text-blue-900 p-3 rounded-lg text-sm font-medium border border-blue-100 text-center">
                          🖨️ Стикер: <span className="font-bold">{tmpl.name}</span> ({order.selectedColors.join('/')})
                       </div>
                    )}

                    <div className="mt-5 pt-5 border-t border-slate-100 flex flex-col gap-4">
                      
                      {isReady ? (
                        <>
                           <span className="text-base font-medium flex items-center gap-2 text-slate-500">
                             <Clock size={18} />
                             {isAssembly ? tmpl.assemblyTimeMinutes : tmpl.packingTimeMinutes} мин
                           </span>
                           <div className="flex gap-2 w-full">
                              {isAssembly ? (
                                 <button 
                                   onClick={() => onComplete(order.id)}
                                   className="w-full bg-slate-900 hover:bg-slate-700 text-white px-5 py-3 rounded-xl text-base font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
                                 >
                                   Собрано <ArrowRight size={20} />
                                 </button>
                              ) : (
                                 // Packing Actions: Client vs Warehouse
                                 <>
                                   <button 
                                     onClick={() => onSendToClient && onSendToClient(order.id)}
                                     className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-100"
                                   >
                                     <Truck size={18} /> Клиенту
                                   </button>
                                   <button 
                                     onClick={() => onSendToWarehouse && onSendToWarehouse(order.id)}
                                     className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100"
                                   >
                                     <Warehouse size={18} /> На склад
                                   </button>
                                 </>
                              )}
                           </div>
                        </>
                      ) : (
                        // Progress Section for Incomplete Items
                        <div className="w-full flex flex-col justify-center gap-3">
                           <div className="flex justify-between text-xs font-bold text-slate-500">
                              <span>Готовность</span>
                              <span>{progress}%</span>
                           </div>
                           <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-indigo-500 transition-all duration-500"
                                style={{ width: `${progress}%` }}
                              />
                           </div>
                        </div>
                      )}

                      {/* Plate Details & Actions */}
                      {isAssembly && sortedPlates.length > 0 && (
                             <div className="mt-1">
                                <p className="text-[10px] uppercase font-bold text-slate-400 mb-2 flex justify-between">
                                  <span>Детали ({printedCount}/{sortedPlates.length}):</span>
                                  {onMovePlate && <span className="text-indigo-400 text-[9px] lowercase font-normal">клик для возврата в очередь</span>}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {sortedPlates.map(plate => {
                                     // Check status of plate
                                     const assignment = order.plateAssignments?.[plate.id];
                                     const isPrinting = assignment && assignment.status === OrderStatus.ASSIGNED;
                                     const isPrinted = assignment && assignment.status === OrderStatus.PRINTED;
                                     const isQueued = !assignment || assignment.status === OrderStatus.QUEUED;

                                     return (
                                        <div 
                                          key={plate.id} 
                                          className="relative group cursor-pointer"
                                          onClick={(e) => handleRequeuePlate(e, order.id, plate.id, plate.name)}
                                          title={`${plate.name}: ${isPrinted ? 'Готово' : (isPrinting ? 'Печатается' : 'В очереди')}. Нажмите, чтобы перепечатать.`}
                                        >
                                           <div 
                                             className={`
                                               w-10 h-10 rounded-lg bg-white overflow-hidden transition-all relative
                                               ${isPrinting 
                                                  ? 'border-2 border-indigo-400 ring-2 ring-indigo-50' 
                                                  : (isPrinted ? 'border border-emerald-300 opacity-60 hover:opacity-100' : 'border border-slate-200 opacity-80')}
                                             `}
                                           >
                                              <img 
                                                src={plate.photoUrl || tmpl.photoUrl} 
                                                className={`w-full h-full object-cover ${isPrinted ? 'grayscale-[0.5]' : ''}`} 
                                                alt={plate.name}
                                              />
                                              
                                              {/* Overlay for Reprint Action */}
                                              {onMovePlate && (
                                                <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                                   <RefreshCw size={16} className="text-white" />
                                                </div>
                                              )}
                                           </div>
                                           
                                           {/* Status Indicators */}
                                           {isPrinting && (
                                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 border-2 border-white rounded-full animate-pulse shadow-sm z-10 pointer-events-none"></div>
                                           )}
                                           {isPrinted && (
                                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full shadow-sm z-10 pointer-events-none"></div>
                                           )}
                                        </div>
                                     );
                                  })}
                                </div>
                             </div>
                           )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Toggle (Visible when closed) */}
      {!isHistoryOpen && (
         <div className="border-l border-slate-200 bg-white flex flex-col shadow-sm z-20">
            <button 
               onClick={() => setIsHistoryOpen(true)}
               className="flex-1 px-2 hover:bg-slate-50 flex flex-col items-center py-6 gap-4 text-slate-400 hover:text-indigo-600 transition-colors"
               title="Открыть историю"
            >
               <div className="bg-slate-100 p-2 rounded-full mb-2">
                 <History size={20} />
               </div>
               <div style={{ writingMode: 'vertical-rl' }} className="font-bold uppercase tracking-widest text-xs rotate-180 flex items-center gap-2">
                 История
               </div>
               <ChevronLeft size={20} className="mt-auto" />
            </button>
         </div>
      )}

      {/* History Sidebar */}
      <div className={`
          bg-white border-l border-slate-200 flex flex-col shadow-2xl z-30 transition-all duration-300 ease-in-out transform
          ${isHistoryOpen ? 'w-96 translate-x-0' : 'w-0 translate-x-full opacity-0 pointer-events-none'}
      `}>
         <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
           <div className="flex items-center gap-2 text-slate-800">
             <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg">
                <CheckCircle2 size={20} />
             </div>
             <h3 className="font-bold text-lg">
               {isAssembly ? 'Собрано' : 'Отправлено'}
             </h3>
             <span className="bg-slate-200 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">
               {historyOrders.length}
             </span>
           </div>
           <button 
             onClick={() => setIsHistoryOpen(false)} 
             className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
           >
             <ChevronRight size={20} />
           </button>
         </div>
         
         <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {historyOrders.length === 0 && (
              <div className="text-center text-slate-400 py-10">
                История пуста
              </div>
            )}
            {historyOrders.map(order => {
                const tmpl = templates.find(t => t.id === order.templateId)!;
                return (
                  <div key={order.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm opacity-75 hover:opacity-100 transition-opacity">
                      <div className="flex gap-3">
                        <img src={tmpl.photoUrl} className="w-12 h-12 bg-slate-100 rounded-lg object-cover" alt="" />
                        <div className="flex-1 min-w-0">
                           <h4 className="font-bold text-slate-800 text-sm truncate">{tmpl.name}</h4>
                           <div className="flex flex-wrap gap-1 mt-1">
                             {order.selectedColors.map(c => {
                               const hex = resolveColorHex(c, colorDefs);
                               const isLight = isLightColor(hex);
                               return (
                               <span 
                                key={c} 
                                className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border shadow-sm"
                                style={{
                                  backgroundColor: hex,
                                  color: getTextColor(hex),
                                  borderColor: isLight ? '#cbd5e1' : hex
                                }}
                               >
                                 {c}
                               </span>
                             )})}
                           </div>
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end">
                         {onRevert && (
                           <button 
                             onClick={() => onRevert(order.id)}
                             className="text-xs font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                           >
                             <RotateCcw size={14} />
                             Вернуть
                           </button>
                         )}
                      </div>
                  </div>
                );
            })}
         </div>
      </div>
    </div>
  );
};
