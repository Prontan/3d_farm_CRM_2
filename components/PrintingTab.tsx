import React, { useMemo } from 'react';
import { Order, Printer, ProductTemplate, OrderStatus, Plate, ColorDef } from '../types';
import { OrderCard } from './OrderCard';
import { Check, RotateCcw, Zap, Combine, Eraser, Scissors } from 'lucide-react';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';

interface PrintingTabProps {
  orders: Order[];
  printers: Printer[];
  templates: ProductTemplate[];
  colorDefs: ColorDef[];
  onMovePlate: (orderId: string, plateId: string, targetPrinterId: string | null, targetIndex?: number) => void;
  onMoveBatch: (items: { orderId: string, plateId: string }[], targetPrinterId: string | null, targetBatchId?: string | null) => void;
  onSplitBatch: (items: { orderId: string, plateId: string }[], count: number) => void;
  onPlateStatusChange: (orderId: string, plateId: string, newStatus: OrderStatus) => void;
  onAutoDistribute: () => void;
  onClearDistribution: () => void;
  onReorderPrinters: (sourceId: string, targetId: string) => void;
  onBatchComplete: (assignments: { orderId: string, plateId: string }[], surplusCount: number, plateDetails: { name: string, colors: string[], plateId: string, templateId: string }) => void;
  onAutoBatchAll: () => void;
  onClearCompleted: () => void;
  onMergeBatches: (sourceItems: { orderId: string, plateId: string }[], targetItems: { orderId: string, plateId: string }[], printerId: string) => void;
  onRevertBatch?: (items: { orderId: string, plateId: string }[]) => void;
}

interface PlateGroup {
  key: string;
  baseKey: string;
  batchId?: string | null;
  plate: Plate;
  template: ProductTemplate;
  colors: string[];
  items: {
    order: Order;
    orderId: string;
    plateId: string;
    status: OrderStatus;
    orderIndex: number;
  }[];
}

const buildGroupKeys = (plate: Plate, colors: string[], batchId?: string | null) => {
  const colorKey = colors.slice().sort().join('-');
  const baseKey = `${plate.name}::${colorKey}::${plate.printTimeMinutes.toFixed(1)}::${plate.filamentType}`;
  const key = `${baseKey}::${batchId || 'default'}`;
  return { key, baseKey };
};

export const PrintingTab: React.FC<PrintingTabProps> = ({
  orders,
  printers,
  templates,
  colorDefs,
  onMovePlate,
  onMoveBatch,
  onSplitBatch,
  onAutoDistribute,
  onClearDistribution,
  onReorderPrinters,
  onBatchComplete,
  onAutoBatchAll,
  onClearCompleted,
  onMergeBatches,
  onRevertBatch
}) => {
  const activePrinters = useMemo(() => printers.filter(p => !p.isMaintenance), [printers]);

  const queueOrders = useMemo(() => {
    return orders
      .filter(order => {
        if ([OrderStatus.PRINTED, OrderStatus.ASSEMBLED, OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.STORED].includes(order.status)) {
          return false;
        }

        const template = templates.find(t => t.id === order.templateId);
        if (!template) return false;

        return (template.plates || []).some(plate => {
          const assignment = order.plateAssignments?.[plate.id];
          return assignment && assignment.status === OrderStatus.QUEUED;
        });
      })
      .sort((a, b) => (a.queueIndex || 0) - (b.queueIndex || 0));
  }, [orders, templates]);

  const groupedPlatesByPrinter = useMemo(() => {
    const map: Record<string, PlateGroup[]> = {};
    activePrinters.forEach(p => {
      map[p.id] = [];
    });

    orders.forEach(order => {
      const template = templates.find(t => t.id === order.templateId);
      if (!template || !template.plates) return;

      template.plates.forEach(plate => {
        const assignment = order.plateAssignments?.[plate.id];
        if (!assignment || !assignment.printerId) return;
        if (!map[assignment.printerId]) return;
        if (![OrderStatus.ASSIGNED, OrderStatus.PRINTED].includes(assignment.status)) return;

        const specificColors = order.plateSpecificColors?.[plate.id];
        const colors = specificColors && specificColors.length > 0 ? specificColors : order.selectedColors;
        const { key, baseKey } = buildGroupKeys(plate, colors, assignment.batchId);

        let group = map[assignment.printerId].find(g => g.key === key);
        if (!group) {
          group = {
            key,
            baseKey,
            batchId: assignment.batchId,
            plate,
            template,
            colors,
            items: []
          };
          map[assignment.printerId].push(group);
        }

        group.items.push({
          order,
          orderId: order.id,
          plateId: plate.id,
          status: assignment.status,
          orderIndex: assignment.orderIndex || 0
        });
      });
    });

    Object.keys(map).forEach(printerId => {
      map[printerId].forEach(group => {
        group.items.sort((a, b) => a.orderIndex - b.orderIndex);
      });

      map[printerId].sort((a, b) => {
        const aMin = a.items[0]?.orderIndex || 0;
        const bMin = b.items[0]?.orderIndex || 0;
        return aMin - bMin;
      });
    });

    return map;
  }, [orders, templates, activePrinters]);

  const handleDragStart = (e: React.DragEvent, orderId: string, plateId?: string) => {
    e.stopPropagation();
    if (!plateId) return;
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'SINGLE', orderId, plateId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleBatchDragStart = (e: React.DragEvent, items: {orderId: string, plateId: string}[], group: PlateGroup) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'BATCH',
      items,
      groupKey: group.key,
      baseKey: group.baseKey
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePrinterDragStart = (e: React.DragEvent, printerId: string) => {
    e.dataTransfer.setData('printerId', printerId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnPrinter = (e: React.DragEvent, targetPrinterId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    const sourcePrinterId = e.dataTransfer.getData('printerId');
    if (sourcePrinterId) {
      if (targetPrinterId && sourcePrinterId !== targetPrinterId) {
        onReorderPrinters(sourcePrinterId, targetPrinterId);
      }
      return;
    }

    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;

    try {
      const payload = JSON.parse(raw);
      if (payload.type === 'BATCH' && Array.isArray(payload.items)) {
        onMoveBatch(payload.items, targetPrinterId);
        return;
      }
      if (payload.orderId && payload.plateId) {
        onMovePlate(payload.orderId, payload.plateId, targetPrinterId);
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const handleDropOnGroup = (e: React.DragEvent, printerId: string, targetGroup: PlateGroup) => {
    e.preventDefault();
    e.stopPropagation();

    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;

    try {
      const payload = JSON.parse(raw);
      if (payload.type !== 'BATCH' || !Array.isArray(payload.items)) return;
      if (payload.groupKey === targetGroup.key) return;

      if (payload.baseKey === targetGroup.baseKey) {
        const targetItems = targetGroup.items.map(i => ({ orderId: i.orderId, plateId: i.plateId }));
        onMergeBatches(payload.items, targetItems, printerId);
      } else {
        onMoveBatch(payload.items, printerId);
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const completeGroup = (group: PlateGroup) => {
    const assignedItems = group.items.filter(i => i.status === OrderStatus.ASSIGNED);
    if (assignedItems.length === 0) return;

    const input = prompt('How many items finished in this batch?', String(assignedItems.length));
    if (!input) return;

    const completedCount = Math.max(0, parseInt(input, 10) || 0);
    const toComplete = assignedItems
      .slice(0, Math.min(completedCount, assignedItems.length))
      .map(i => ({ orderId: i.orderId, plateId: i.plateId }));

    const surplus = Math.max(0, completedCount - assignedItems.length);
    onBatchComplete(toComplete, surplus, {
      name: group.plate.name,
      colors: group.colors,
      plateId: group.plate.id,
      templateId: group.template.id
    });
  };

  const splitGroup = (group: PlateGroup) => {
    const assignedItems = group.items.filter(i => i.status === OrderStatus.ASSIGNED);
    if (assignedItems.length < 2) return;

    const count = Math.floor(assignedItems.length / 2);
    const splitItems = assignedItems
      .slice(assignedItems.length - count)
      .map(i => ({ orderId: i.orderId, plateId: i.plateId }));

    onSplitBatch(splitItems, count);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full gap-6 overflow-hidden bg-slate-100 relative">
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-4">
        <button
          onClick={onClearCompleted}
          className="bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 p-4 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 border border-slate-200"
          title="Clear completed printer batches"
        >
          <Eraser size={24} />
          <span className="font-bold text-lg hidden sm:inline">Clear Completed</span>
        </button>

        <button
          onClick={onAutoBatchAll}
          className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl hover:bg-slate-800 transition-all hover:scale-105 active:scale-95 flex items-center gap-3 border border-slate-700"
          title="Merge identical parts into batches"
        >
          <Combine size={24} />
          <span className="font-bold text-lg hidden sm:inline">Auto Batch</span>
        </button>
      </div>

      <div
        className="lg:w-1/4 w-full flex flex-col bg-white border-r border-slate-200 h-[350px] lg:h-full lg:min-w-[350px] shadow-lg z-10"
        onDragOver={handleDragOver}
        onDrop={(e) => handleDropOnPrinter(e, null)}
      >
        <div className="p-6 border-b border-slate-100 bg-white flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              Queue
              <span className="bg-slate-200 text-slate-700 text-lg px-3 py-0.5 rounded-full min-w-[32px] text-center">{queueOrders.length}</span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearDistribution}
                className="bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 p-2 rounded-lg transition-all shadow-sm"
                title="Clear distribution"
              >
                <RotateCcw size={20} />
              </button>
              <button
                onClick={onAutoDistribute}
                className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg transition-colors shadow-sm"
                title="Auto distribute"
              >
                <Zap size={20} className="fill-current" />
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-500 font-medium">Drag individual plates to printer columns or run auto-distribution.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-50">
          {queueOrders.length === 0 && (
            <div className="text-center text-slate-400 py-20 text-lg">No active queue items</div>
          )}
          {queueOrders.map(order => (
            <div key={order.id}>
              <OrderCard
                order={order}
                template={templates.find(t => t.id === order.templateId)!}
                isDraggable={true}
                onDragStart={handleDragStart}
                colorDefs={colorDefs}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6 items-stretch mb-20">
          {activePrinters.map(printer => {
            const groups = groupedPlatesByPrinter[printer.id] || [];

            const assignedJobs = groups.reduce((acc, g) => acc + g.items.filter(i => i.status === OrderStatus.ASSIGNED).length, 0);
            const printMinutes = groups.reduce((acc, g) => {
              const count = g.items.filter(i => i.status === OrderStatus.ASSIGNED).length;
              return acc + count * g.plate.printTimeMinutes;
            }, 0);
            const totalMinutes = printMinutes + Math.max(0, assignedJobs - 1) * 10;

            const normalLimit = 12 * 60;
            const extendedLimit = 20 * 60;
            const hasExtendedOrders = groups.some(g => g.items.some(i => i.order.usesExtendedHours));
            const displayLimit = (hasExtendedOrders || totalMinutes > normalLimit) ? extendedLimit : normalLimit;
            const usagePercent = Math.min((totalMinutes / displayLimit) * 100, 100);
            const isOverloaded = totalMinutes > extendedLimit;
            const isExtended = !isOverloaded && totalMinutes > normalLimit;

            return (
              <div
                key={printer.id}
                draggable
                onDragStart={(e) => handlePrinterDragStart(e, printer.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnPrinter(e, printer.id)}
                className="flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 h-full overflow-hidden cursor-move transition-transform active:scale-[0.99]"
              >
                <div className="p-5 border-b border-slate-100 flex-shrink-0">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold text-slate-800 truncate">{printer.name}</h3>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {printer.supportedColors.map(c => {
                          const hex = resolveColorHex(c, colorDefs);
                          return (
                            <div key={c} className="w-5 h-5 rounded border border-slate-200 shadow-sm" style={{ backgroundColor: hex }} title={c} />
                          );
                        })}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wide border ${printer.isMultiColor ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                      {printer.isMultiColor ? 'Multi' : 'Single'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="flex justify-between text-sm font-medium mb-1.5">
                      <span className={isOverloaded ? 'text-red-600 font-bold' : (isExtended ? 'text-orange-600 font-bold' : 'text-slate-600')}>
                        {Math.floor(Math.ceil(totalMinutes) / 60)}ч {Math.ceil(totalMinutes) % 60}м / {Math.floor(displayLimit / 60)}ч
                      </span>
                      <span className="text-slate-500">{Math.round(usagePercent)}%</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${isOverloaded ? 'bg-red-500' : (isExtended ? 'bg-orange-500' : 'bg-emerald-500')}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-3 min-h-[220px] bg-white flex-1 flex flex-col">
                  {groups.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-center text-slate-400 text-base border-2 border-dashed border-slate-200 rounded-xl m-2 pointer-events-none">
                      Free
                    </div>
                  )}

                  {groups.map(group => {
                    const assignedItems = group.items.filter(i => i.status === OrderStatus.ASSIGNED);
                    const printedItems = group.items.filter(i => i.status === OrderStatus.PRINTED);
                    const allDone = assignedItems.length === 0 && printedItems.length > 0;
                    const progressText = allDone ? 'Done' : `${printedItems.length} / ${group.items.length}`;

                    return (
                      <div
                        key={group.key}
                        draggable={!allDone && assignedItems.length > 0}
                        onDragStart={(e) => {
                          const items = assignedItems.map(i => ({ orderId: i.orderId, plateId: i.plateId }));
                          if (items.length > 0) {
                            handleBatchDragStart(e, items, group);
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDrop={(e) => handleDropOnGroup(e, printer.id, group)}
                        className={`relative p-3 rounded-xl border flex flex-col gap-2 transition-all ${allDone ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-indigo-100 shadow-sm hover:shadow-md ring-1 ring-indigo-50 hover:ring-indigo-300'}`}
                      >
                        <div className="flex items-start gap-3">
                          <img
                            src={group.plate.photoUrl || group.template.photoUrl}
                            className="w-12 h-12 rounded-lg bg-slate-100 object-cover border border-slate-100"
                            alt={group.plate.name}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-800 text-sm leading-tight mb-0.5 line-clamp-2">{group.plate.name}</div>
                            <div className="text-xs text-slate-500 truncate">{group.template.name}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {group.colors.map(c => {
                                const hex = resolveColorHex(c, colorDefs);
                                const light = isLightColor(hex);
                                return (
                                  <span
                                    key={c}
                                    className="text-sm font-extrabold px-2.5 py-1 rounded border shadow-sm uppercase tracking-wide"
                                    style={{
                                      backgroundColor: hex,
                                      color: getTextColor(hex),
                                      borderColor: light ? '#cbd5e1' : hex
                                    }}
                                  >
                                    {c}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-1">
                          <div className="text-xs font-bold text-slate-400">{group.plate.printTimeMinutes}м • {progressText}</div>

                          {!allDone ? (
                            <div className="flex gap-1.5">
                              {assignedItems.length > 1 && (
                                <button
                                  onClick={() => splitGroup(group)}
                                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 p-1.5 rounded-lg border border-slate-200"
                                  title="Split batch"
                                >
                                  <Scissors size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => completeGroup(group)}
                                className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                              >
                                <Check size={12} /> Done
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-emerald-600">Completed</span>
                              {onRevertBatch && printedItems.length > 0 && (
                                <button
                                  onClick={() => onRevertBatch(printedItems.map(i => ({ orderId: i.orderId, plateId: i.plateId })))}
                                  className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"
                                  title="Revert batch"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {group.items.length > 0 && (
                          <div className="absolute top-0 left-0 h-1 bg-slate-200 w-full rounded-t-xl overflow-hidden">
                            <div
                              className={`h-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                              style={{ width: `${(printedItems.length / group.items.length) * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
