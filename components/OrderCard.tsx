import React from 'react';
import { Order, ProductTemplate, Printer, OrderStatus, ColorDef } from '../types';
import { AlertTriangle, Clock, MessageCircle, Layers, GripVertical, Image as ImageIcon, Palette } from 'lucide-react';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';
import { formatDateTimeLA } from '../utils/deadlines';

interface OrderCardProps {
  order: Order;
  template: ProductTemplate;
  colorDefs: ColorDef[];
  showWarnings?: boolean; // For print queue: check colors/compatibility
  assignedPrinter?: Printer;
  isDraggable?: boolean; // If true, enables Drag of PLATES, not the card itself (in Queue mode)
  onDragStart?: (e: React.DragEvent, orderId: string, plateId?: string) => void;
  compact?: boolean;
  actionButton?: React.ReactNode;
}

export const OrderCard: React.FC<OrderCardProps> = ({
  order,
  template,
  colorDefs,
  showWarnings = false,
  assignedPrinter,
  isDraggable = false,
  onDragStart,
  compact = false,
  actionButton,
}) => {
  const hasComment = order.comments && order.comments.trim().length > 0;
  const isCustom = order.isCustomColor;
  const isOverdue = !!order.deadlineAt && ![OrderStatus.SHIPPED, OrderStatus.STORED].includes(order.status) && Date.now() > order.deadlineAt;
  const hasDeadlineRisk = !!order.needsManualScheduling || isOverdue;
  const usesExtended = !!order.usesExtendedHours && !hasDeadlineRisk;
  const deadlineLabel = order.deadlineAt ? formatDateTimeLA(order.deadlineAt) : null;

  // Handle Drag Start for a SPECIFIC PLATE
  const handlePlateDragStart = (e: React.DragEvent, plateId: string) => {
    e.stopPropagation();
    if (isDraggable && onDragStart) {
      // We pass both OrderID and PlateID
      onDragStart(e, order.id, plateId);
    }
  };

  // Legacy full-card drag (for AddOrderTab reordering)
  const handleCardDragStart = (e: React.DragEvent) => {
    if (onDragStart) onDragStart(e, order.id);
  };

  const hasPlates = template.plates && template.plates.length > 0;
  
  return (
    <div
      draggable={!isDraggable && !!onDragStart} // Only draggable as a whole if NOT in plate-drag mode
      onDragStart={handleCardDragStart}
      className={`
        relative bg-white rounded-xl shadow-sm border transition-all
        ${(!isDraggable && onDragStart) ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''}
        ${hasDeadlineRisk
          ? 'border-red-400 border-2 bg-red-50'
          : (hasComment
            ? 'border-amber-400 border-2 bg-amber-50'
            : (usesExtended ? 'border-orange-400 border-2 bg-orange-50' : 'border-slate-200'))}
        ${compact ? 'p-3' : 'p-4'}
        flex flex-col gap-3
      `}
    >
      {/* Header: Image and Name */}
      <div className="flex gap-4">
        <img 
          src={template.photoUrl} 
          alt={template.name} 
          className={`object-cover rounded-lg bg-slate-100 ${compact ? 'w-14 h-14' : 'w-16 h-16'}`} 
        />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <h4 className={`font-bold text-slate-800 leading-tight truncate ${compact ? 'text-base' : 'text-lg'}`}>
            {template.name}
          </h4>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {order.etsyOrderId && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-300">
                Etsy #{order.etsyOrderId}
              </span>
            )}
            {deadlineLabel && (
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${
                hasDeadlineRisk
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : (usesExtended
                    ? 'bg-orange-100 text-orange-700 border-orange-300'
                    : 'bg-blue-50 text-blue-700 border-blue-200')
              }`}>
                Due {deadlineLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
             {isCustom ? (
                <span className="flex items-center gap-1 text-sm font-bold px-3 py-1.5 rounded border-2 text-purple-700 bg-purple-50 border-purple-200 uppercase tracking-wide">
                   <Palette size={16} /> Custom
                </span>
             ) : (
                <div className="flex flex-wrap gap-2">
                  {order.selectedColors.map(c => {
                     const hex = resolveColorHex(c, colorDefs);
                     const isLight = isLightColor(hex);
                     return (
                       <span 
                        key={c} 
                        className="flex items-center gap-1.5 text-base font-black uppercase tracking-wide px-4 py-1.5 rounded-lg border-2 shadow-sm"
                        style={{
                          backgroundColor: hex,
                          color: getTextColor(hex),
                          borderColor: isLight ? '#cbd5e1' : hex
                        }}
                       >
                          {c}
                       </span>
                     );
                  })}
                  {order.selectedColors.length === 0 && (
                     <span className="text-xs font-semibold px-2 py-0.5 rounded border text-slate-500 bg-slate-100 border-slate-200">
                       Standard
                     </span>
                  )}
                </div>
             )}
          </div>
        </div>
      </div>

      {/* Warnings & Info */}
      {(hasComment) && (
        <div className="flex flex-wrap gap-2 mt-1">
           {hasComment && (
            <div className="flex items-start gap-2 text-sm font-bold text-amber-800 bg-amber-200 px-3 py-2 rounded-lg w-full border border-amber-300">
              <MessageCircle size={18} className="mt-0.5 flex-shrink-0" />
              <span className="leading-snug">{order.comments}</span>
            </div>
          )}
        </div>
      )}

      {/* PLATE LIST (Interactive for Queue) */}
      {hasPlates && isDraggable && (
        <div className="mt-2 space-y-2">
           <div className="flex items-center gap-1.5 font-bold mb-1 text-slate-400 uppercase tracking-wider text-[10px]">
             <Layers size={10} /> Детали для печати ({template.plates.length})
           </div>
           
           {template.plates.map((plate) => {
             // Check assignment status
             const assignment = order.plateAssignments?.[plate.id];
             const isAssigned = assignment && assignment.printerId !== null;
             const isPrinted = assignment && assignment.status === OrderStatus.PRINTED;
             
             // Determine state
             const isLocked = isAssigned || isPrinted;
             
             // Determine specific color for this plate
             const specificColors = order.plateSpecificColors?.[plate.id];
             const displayColors = specificColors && specificColors.length > 0 ? specificColors : order.selectedColors;

             // Image logic: Prefer plate image, fallback to template image
             const plateImage = plate.photoUrl || template.photoUrl;

             return (
               <div 
                 key={plate.id}
                 draggable={!isLocked}
                 onDragStart={(e) => handlePlateDragStart(e, plate.id)}
                 className={`
                    flex justify-between items-center p-2 rounded-lg border text-sm transition-all
                    ${isLocked 
                      ? 'bg-slate-100 border-slate-200 text-slate-400' 
                      : 'bg-white border-slate-300 text-slate-700 shadow-sm cursor-grab hover:border-indigo-400 hover:shadow-md active:cursor-grabbing'}
                 `}
               >
                  <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                    {!isLocked && <GripVertical size={20} className="text-slate-300 flex-shrink-0" />}
                    
                    {/* Plate Thumbnail */}
                    <div className="w-12 h-12 rounded-lg bg-slate-200 flex-shrink-0 overflow-hidden relative">
                        <img src={plateImage} className="w-full h-full object-cover" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                       <div className="font-bold truncate">{plate.name}</div>
                       <div className="flex flex-wrap gap-1 mt-1">
                          {displayColors.map(c => {
                              const hex = resolveColorHex(c, colorDefs);
                              return (
                                <div key={c} className="w-3 h-3 rounded-full border border-slate-300" style={{backgroundColor: hex}} title={c} />
                              )
                          })}
                          <span className="text-xs text-slate-400 ml-1">
                             {plate.printTimeMinutes}м
                          </span>
                       </div>
                    </div>
                  </div>
                  
                  <div className="text-xs font-bold px-2 py-1 rounded bg-slate-100 text-slate-500 whitespace-nowrap ml-2">
                     {isPrinted ? 'Готово' : (isAssigned ? 'В печати' : 'Очередь')}
                  </div>
               </div>
             );
           })}
        </div>
      )}
      
      {actionButton && (
        <div className="mt-2 pt-2 border-t border-slate-100">
           {actionButton}
        </div>
      )}
    </div>
  );
};
