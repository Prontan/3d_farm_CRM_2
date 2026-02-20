
import React, { useState, useRef, useEffect } from 'react';
import { StockItem, ProductTemplate, ColorDef, FilamentStock } from '../types';
import { Package, Search, MinusCircle, Palette, Scale, Plus, BoxSelect, ArrowDown, ArrowUp, AlertTriangle, Trash2, Layers, Image as ImageIcon, X, Check, ChevronDown } from 'lucide-react';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';

interface Props {
  stockItems: StockItem[];
  templates: ProductTemplate[];
  colorDefs: ColorDef[];
  filamentStock?: FilamentStock[]; // Optional for backward compatibility if not passed
  onDecreaseStock: (itemId: string, amount: number) => void;
  onAddFilament?: (color: string, type: string, grams: number) => void;
  onDeleteFilament?: (color: string, type: string) => void;
  onAddPartToStock?: (templateId: string, plateId: string, colors: string[], quantity: number) => void;
}

export const StockTab: React.FC<Props> = ({ 
  stockItems, 
  templates, 
  colorDefs, 
  filamentStock = [], 
  onDecreaseStock,
  onAddFilament,
  onDeleteFilament,
  onAddPartToStock
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'PRODUCTS' | 'PARTS' | 'FILAMENT'>('PRODUCTS');
  const [searchTerm, setSearchTerm] = useState('');

  // Filament Form State
  const [newFilamentColor, setNewFilamentColor] = useState(colorDefs[0]?.name || '');
  const [newFilamentType, setNewFilamentType] = useState('PLA');
  const [newFilamentWeight, setNewFilamentWeight] = useState(1000);
  const [filamentAction, setFilamentAction] = useState<'ADD' | 'DEDUCT'>('ADD');

  // Add Part Modal State
  const [addPartModal, setAddPartModal] = useState(false);
  const [addPartTemplateId, setAddPartTemplateId] = useState('');
  const [addPartPlateId, setAddPartPlateId] = useState('');
  const [addPartColors, setAddPartColors] = useState<string[]>([]);
  const [addPartQuantity, setAddPartQuantity] = useState(1);
  
  // Custom Dropdown State for Add Part Modal
  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Write-off Modal State
  const [writeOffModal, setWriteOffModal] = useState<{
    item: StockItem;
    name: string;
    max: number;
  } | null>(null);
  const [writeOffAmount, setWriteOffAmount] = useState<number>(1);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsTemplateDropdownOpen(false);
      }
    }
    if (isTemplateDropdownOpen) {
        document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTemplateDropdownOpen]);

  const filteredItems = stockItems.filter(item => {
    // If PART, try to find plate Name
    if (item.type === 'PART') {
         // We might need to scan templates to find the plate name if not stored
         // Optimally, item.plateId helps.
         const tmpl = templates.find(t => t.id === item.templateId);
         const plate = tmpl?.plates?.find(p => p.id === item.plateId);
         const name = plate?.name || "Деталь";
         return name.toLowerCase().includes(searchTerm.toLowerCase());
    }
    
    // Product
    const tmpl = templates.find(t => t.id === item.templateId);
    if (!tmpl) return false;
    return tmpl.name.toLowerCase().includes(searchTerm.toLowerCase());
  }).sort((a, b) => b.quantity - a.quantity);

  const sortedFilament = [...filamentStock].sort((a, b) => a.color.localeCompare(b.color));

  const openWriteOffModal = (item: StockItem, name: string) => {
    setWriteOffModal({ item, name, max: item.quantity });
    setWriteOffAmount(1);
  };

  const handleConfirmWriteOff = () => {
    if (writeOffModal) {
      onDecreaseStock(writeOffModal.item.id, writeOffAmount);
      setWriteOffModal(null);
    }
  };

  const handleAddPartSubmit = () => {
     if (onAddPartToStock && addPartTemplateId && addPartPlateId && addPartColors.length > 0) {
         onAddPartToStock(addPartTemplateId, addPartPlateId, addPartColors, addPartQuantity);
         // Reset
         setAddPartModal(false);
         setAddPartTemplateId('');
         setAddPartPlateId('');
         setAddPartColors([]);
         setAddPartQuantity(1);
         setTemplateSearchTerm('');
     }
  };

  const togglePartColor = (colorName: string) => {
     if (addPartColors.includes(colorName)) {
        if (addPartColors.length > 1) { // Prevent empty selection
           setAddPartColors(prev => prev.filter(c => c !== colorName));
        }
     } else {
        setAddPartColors(prev => [...prev, colorName]);
     }
  };

  // Helper for Add Part Modal
  const selectedAddTemplate = templates.find(t => t.id === addPartTemplateId);
  const selectedAddPlate = selectedAddTemplate?.plates?.find(p => p.id === addPartPlateId);

  const renderProductItem = (item: StockItem) => {
    const tmpl = templates.find(t => t.id === item.templateId);
    if (!tmpl) return null;

    return (
      <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
        <div className="relative h-48 bg-slate-100">
            <img src={tmpl.photoUrl} className="w-full h-full object-cover" alt={tmpl.name} />
            <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm">
                x{item.quantity}
            </div>
            {item.isCustom && (
                <div className="absolute top-3 left-3 bg-purple-100 text-purple-700 px-2 py-1 rounded-lg text-xs font-bold border border-purple-200 uppercase tracking-wide flex items-center gap-1">
                <Palette size={12} /> Custom
                </div>
            )}
        </div>
        
        <div className="p-5 flex-1 flex flex-col">
            <h3 className="text-xl font-bold text-slate-800 leading-tight mb-2">{tmpl.name}</h3>
            
            <div className="mb-4">
                {item.isCustom && item.plateSpecificColors ? (
                <div className="flex flex-col gap-1">
                    {tmpl.plates?.map(plate => {
                        const plateColors = item.plateSpecificColors?.[plate.id];
                        if (!plateColors) return null;
                        return (
                        <div key={plate.id} className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 font-medium truncate max-w-[120px]">{plate.name}:</span>
                            <div className="flex gap-1">
                                {plateColors.map(c => {
                                const hex = resolveColorHex(c, colorDefs);
                                const isLight = isLightColor(hex);
                                return (
                                <span 
                                    key={c} 
                                    className="flex items-center gap-1 font-bold px-1.5 py-0.5 rounded border shadow-sm"
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
                        )
                    })}
                </div>
                ) : (
                <div className="flex flex-wrap gap-1.5">
                    {item.colors.map(c => {
                        const hex = resolveColorHex(c, colorDefs);
                        const isLight = isLightColor(hex);
                        return (
                        <span 
                        key={c} 
                        className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-2 py-1 rounded border shadow-sm"
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
                )}
            </div>

            <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm text-slate-400 font-medium">
                    Готово к отгрузке
                </span>
                <button 
                onClick={() => openWriteOffModal(item, tmpl.name)}
                className="text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 p-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold"
                title="Списать"
                >
                    <MinusCircle size={18} /> Списать
                </button>
            </div>
        </div>
        </div>
    );
  };

  const renderPartItem = (item: StockItem) => {
    const tmpl = templates.find(t => t.id === item.templateId);
    const plate = tmpl?.plates?.find(p => p.id === item.plateId);
    
    // Fallback info if template deleted
    const name = plate?.name || "Неизвестная деталь";
    const image = plate?.photoUrl || tmpl?.photoUrl;

    return (
        <div key={item.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex gap-4 hover:shadow-md transition-shadow">
             <div className="w-20 h-20 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 flex-shrink-0">
                 {image ? (
                     <img src={image} className="w-full h-full object-cover" />
                 ) : (
                     <ImageIcon className="text-slate-300 w-8 h-8 m-auto mt-6" />
                 )}
             </div>
             
             <div className="flex-1 flex flex-col justify-between">
                 <div>
                    <h3 className="font-bold text-slate-800">{name}</h3>
                    <div className="text-xs text-slate-400 mb-2">{tmpl?.name || "Товар удален"}</div>
                    
                    <div className="flex flex-wrap gap-1">
                        {item.colors.map(c => {
                            const hex = resolveColorHex(c, colorDefs);
                            return (
                                <span 
                                key={c} 
                                className="w-4 h-4 rounded-full border border-slate-200 shadow-sm" 
                                style={{ backgroundColor: hex }} 
                                title={c}
                                />
                            );
                        })}
                    </div>
                 </div>
                 
                 <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                    <span className="font-bold text-lg text-slate-700">x{item.quantity}</span>
                    <button 
                        onClick={() => openWriteOffModal(item, name)}
                        className="text-red-500 hover:bg-red-50 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
                    >
                        Списать
                    </button>
                 </div>
             </div>
        </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
       {/* Write-Off Modal */}
       {writeOffModal && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
               <div className="flex justify-between items-center mb-4">
                 <h3 className="text-xl font-bold text-slate-800">Списать со склада</h3>
                 <button onClick={() => setWriteOffModal(null)} className="text-slate-400 hover:text-slate-600">
                   <X size={24} />
                 </button>
               </div>
               
               <p className="text-slate-500 text-sm mb-6">
                  {writeOffModal.name} <br/>
                  <span className="text-xs">Всего доступно: {writeOffModal.max}</span>
               </p>

               <div className="flex items-center justify-center gap-4 mb-8">
                  <button 
                     onClick={() => setWriteOffAmount(Math.max(1, writeOffAmount - 1))}
                     className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors"
                  >
                     <MinusCircle size={24} />
                  </button>
                  
                  <div className="w-24">
                     <input 
                        type="number" 
                        value={writeOffAmount}
                        onChange={(e) => {
                           const val = parseInt(e.target.value);
                           if (!isNaN(val)) {
                              setWriteOffAmount(Math.min(writeOffModal.max, Math.max(1, val)));
                           }
                        }}
                        className="w-full text-center text-3xl font-bold text-slate-800 bg-transparent border-b-2 border-slate-200 focus:border-indigo-500 outline-none pb-1"
                     />
                  </div>

                  <button 
                     onClick={() => setWriteOffAmount(Math.min(writeOffModal.max, writeOffAmount + 1))}
                     className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors"
                  >
                     <Plus size={24} />
                  </button>
               </div>

               <div className="flex gap-3">
                  <button 
                    onClick={() => setWriteOffModal(null)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors"
                  >
                    Отмена
                  </button>
                  <button 
                    onClick={handleConfirmWriteOff}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-red-200"
                  >
                    Списать
                  </button>
               </div>
            </div>
         </div>
       )}
       
       {/* Add Part Modal */}
       {addPartModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-5xl animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto min-h-[600px] flex flex-col">
                 <div className="flex justify-between items-center mb-6 flex-shrink-0">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Layers size={24} className="text-indigo-600" />
                        Добавить деталь на склад
                    </h3>
                    <button onClick={() => setAddPartModal(false)} className="text-slate-400 hover:text-slate-600">
                      <X size={24} />
                    </button>
                 </div>
                 
                 <div className="space-y-6 flex-1">
                     {/* Step 1: Select Template with Custom Dropdown */}
                     <div className="relative" ref={dropdownRef}>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Товар (Шаблон)</label>
                        
                        <button
                           type="button"
                           onClick={() => setIsTemplateDropdownOpen(!isTemplateDropdownOpen)}
                           className="w-full p-4 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 text-left flex items-center justify-between transition-shadow shadow-sm"
                        >
                           {addPartTemplateId && selectedAddTemplate ? (
                              <div className="flex items-center gap-4">
                                 {selectedAddTemplate.photoUrl ? (
                                     <img src={selectedAddTemplate.photoUrl} className="w-10 h-10 rounded-lg object-cover bg-slate-100 border border-slate-200" alt="" />
                                 ) : (
                                     <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                                         <ImageIcon size={18} className="text-slate-400" />
                                     </div>
                                 )}
                                 <span className="font-bold text-lg text-slate-800">{selectedAddTemplate.name}</span>
                              </div>
                           ) : (
                              <span className="text-slate-500 font-medium text-lg">Выберите товар...</span>
                           )}
                           <ChevronDown size={24} className="text-slate-400" />
                        </button>

                        {isTemplateDropdownOpen && (
                             <div className="absolute top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top">
                                 <div className="p-3 border-b border-slate-100 bg-slate-50/50">
                                      <div className="relative">
                                          <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                          <input 
                                              type="text"
                                              placeholder="Поиск..."
                                              className="w-full pl-10 pr-3 py-3 text-base bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                                              value={templateSearchTerm}
                                              onChange={(e) => setTemplateSearchTerm(e.target.value)}
                                              autoFocus
                                          />
                                      </div>
                                 </div>
                                 <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                                     {templates
                                         .filter(t => t.name.toLowerCase().includes(templateSearchTerm.toLowerCase()))
                                         .map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => {
                                                    setAddPartTemplateId(t.id);
                                                    setAddPartPlateId('');
                                                    setAddPartColors([]);
                                                    setIsTemplateDropdownOpen(false);
                                                    setTemplateSearchTerm('');
                                                }}
                                                className={`w-full flex items-center gap-4 p-3 hover:bg-indigo-50 rounded-xl transition-colors text-left group ${addPartTemplateId === t.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''}`}
                                            >
                                                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex-shrink-0">
                                                    {t.photoUrl ? (
                                                        <img src={t.photoUrl} className="w-full h-full object-cover" alt="" />
                                                    ) : (
                                                        <ImageIcon size={20} className="text-slate-300 m-auto mt-3" />
                                                    )}
                                                </div>
                                                <span className={`font-bold text-base ${addPartTemplateId === t.id ? 'text-indigo-700' : 'text-slate-700 group-hover:text-indigo-700'}`}>
                                                    {t.name}
                                                </span>
                                                {addPartTemplateId === t.id && <Check size={20} className="ml-auto text-indigo-600" />}
                                            </button>
                                         ))
                                     }
                                     {templates.filter(t => t.name.toLowerCase().includes(templateSearchTerm.toLowerCase())).length === 0 && (
                                         <div className="p-6 text-center text-slate-400 text-sm">Ничего не найдено</div>
                                     )}
                                 </div>
                             </div>
                        )}
                     </div>

                     {/* Step 2: Select Plate */}
                     {addPartTemplateId && selectedAddTemplate && (
                         <div className="animate-in fade-in slide-in-from-top-2">
                            <label className="block text-sm font-bold text-slate-700 mb-1">Деталь</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-60 overflow-y-auto p-1">
                               {selectedAddTemplate.plates?.map(plate => (
                                  <div 
                                    key={plate.id}
                                    onClick={() => {
                                        setAddPartPlateId(plate.id);
                                        // Set default colors
                                        const defs = plate.colors && plate.colors.length > 0 ? plate.colors : (selectedAddTemplate.defaultColors || []);
                                        setAddPartColors(defs.length > 0 ? defs : [colorDefs[0]?.name || 'Unknown']);
                                    }}
                                    className={`
                                       cursor-pointer border rounded-xl p-3 flex items-center gap-3 transition-all hover:shadow-md
                                       ${addPartPlateId === plate.id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300 bg-white'}
                                    `}
                                  >
                                      <div className="w-10 h-10 bg-white rounded-lg border border-slate-100 flex-shrink-0 overflow-hidden">
                                          {plate.photoUrl ? <img src={plate.photoUrl} className="w-full h-full object-cover"/> : <ImageIcon size={16} className="text-slate-300 m-auto mt-2"/>}
                                      </div>
                                      <span className="text-sm font-bold text-slate-700 truncate">{plate.name}</span>
                                  </div>
                               ))}
                            </div>
                         </div>
                     )}

                     {/* Step 3: Colors & Quantity */}
                     {addPartPlateId && (
                        <div className="animate-in fade-in slide-in-from-top-2 space-y-5 pt-4 border-t border-slate-100">
                             <div>
                                 <label className="block text-sm font-bold text-slate-700 mb-2">Цвета</label>
                                 <div className="flex flex-wrap gap-2">
                                    {colorDefs.map(c => {
                                        const hex = c.hex;
                                        const isLight = isLightColor(hex);
                                        const isSelected = addPartColors.includes(c.name);
                                        return (
                                            <button
                                                key={c.name}
                                                onClick={() => togglePartColor(c.name)}
                                                className={`
                                                    flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-transform active:scale-95 shadow-sm
                                                    ${isSelected ? 'ring-2 ring-slate-400 scale-105 font-bold' : 'opacity-80 hover:opacity-100'}
                                                `}
                                                style={{
                                                  backgroundColor: hex,
                                                  color: getTextColor(hex),
                                                  borderColor: isLight ? '#cbd5e1' : hex
                                                }}
                                            >
                                                {isSelected && <Check size={14} strokeWidth={3} />}
                                                {c.name}
                                            </button>
                                        );
                                    })}
                                 </div>
                             </div>

                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Количество</label>
                                <div className="flex items-center gap-4">
                                    <button 
                                        onClick={() => setAddPartQuantity(Math.max(1, addPartQuantity - 1))}
                                        className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors"
                                    >
                                        <MinusCircle size={24} />
                                    </button>
                                    <input 
                                        type="number" 
                                        value={addPartQuantity}
                                        onChange={e => setAddPartQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="w-24 text-center font-bold text-2xl border-b-2 border-slate-200 focus:border-indigo-500 outline-none bg-transparent"
                                    />
                                    <button 
                                        onClick={() => setAddPartQuantity(addPartQuantity + 1)}
                                        className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold transition-colors"
                                    >
                                        <Plus size={24} />
                                    </button>
                                </div>
                             </div>
                        </div>
                     )}
                 </div>

                 <div className="flex gap-4 mt-8 pt-4 border-t border-slate-100 flex-shrink-0">
                     <button 
                        onClick={() => setAddPartModal(false)}
                        className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors text-lg"
                     >
                        Отмена
                     </button>
                     <button 
                        onClick={handleAddPartSubmit}
                        disabled={!addPartTemplateId || !addPartPlateId || addPartColors.length === 0}
                        className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                     >
                        Добавить
                     </button>
                 </div>
              </div>
          </div>
       )}

       <div className="p-8 pb-4">
         <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center gap-4 mb-2">
                 <button 
                   onClick={() => setActiveSubTab('PRODUCTS')}
                   className={`text-2xl font-bold flex items-center gap-2 transition-opacity ${activeSubTab === 'PRODUCTS' ? 'text-slate-800' : 'text-slate-400 opacity-60 hover:opacity-100'}`}
                 >
                    <Package className={activeSubTab === 'PRODUCTS' ? "text-indigo-600" : "text-slate-400"} size={32} />
                    Продукция
                 </button>
                 <div className="h-8 w-px bg-slate-300"></div>
                 <button 
                   onClick={() => setActiveSubTab('PARTS')}
                   className={`text-2xl font-bold flex items-center gap-2 transition-opacity ${activeSubTab === 'PARTS' ? 'text-slate-800' : 'text-slate-400 opacity-60 hover:opacity-100'}`}
                 >
                    <Layers className={activeSubTab === 'PARTS' ? "text-blue-600" : "text-slate-400"} size={32} />
                    Детали
                 </button>
                 <div className="h-8 w-px bg-slate-300"></div>
                 <button 
                   onClick={() => setActiveSubTab('FILAMENT')}
                   className={`text-2xl font-bold flex items-center gap-2 transition-opacity ${activeSubTab === 'FILAMENT' ? 'text-slate-800' : 'text-slate-400 opacity-60 hover:opacity-100'}`}
                 >
                    <Scale className={activeSubTab === 'FILAMENT' ? "text-emerald-600" : "text-slate-400"} size={32} />
                    Филамент
                 </button>
              </div>
            </div>
            
            {activeSubTab !== 'FILAMENT' && (
              <div className="relative w-full sm:w-80">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                 <input 
                   type="text" 
                   placeholder={activeSubTab === 'PRODUCTS' ? "Поиск товара..." : "Поиск детали..."}
                   className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                   value={searchTerm}
                   onChange={e => setSearchTerm(e.target.value)}
                 />
              </div>
            )}
         </div>
       </div>

       <div className="flex-1 overflow-y-auto p-8 pt-4">
          
          {/* --- PRODUCTS VIEW --- */}
          {activeSubTab === 'PRODUCTS' && (
             <>
               {filteredItems.filter(i => !i.type || i.type === 'PRODUCT').length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                     <Package size={64} className="mb-4" />
                     <p className="text-2xl font-medium">Склад продукции пуст</p>
                  </div>
               ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                     {filteredItems.filter(i => !i.type || i.type === 'PRODUCT').map(renderProductItem)}
                  </div>
               )}
             </>
          )}

          {/* --- PARTS VIEW --- */}
          {activeSubTab === 'PARTS' && (
             <>
               <div className="flex justify-end mb-4">
                   <button 
                      onClick={() => setAddPartModal(true)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm"
                   >
                      <Plus size={20} /> Добавить деталь
                   </button>
               </div>

               {filteredItems.filter(i => i.type === 'PART').length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
                     <Layers size={64} className="mb-4" />
                     <p className="text-2xl font-medium">Нет запасных деталей</p>
                  </div>
               ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                     {filteredItems.filter(i => i.type === 'PART').map(renderPartItem)}
                  </div>
               )}
             </>
          )}

          {/* --- FILAMENT VIEW --- */}
          {activeSubTab === 'FILAMENT' && (
             <div className="flex flex-col lg:flex-row gap-8">
               {/* List */}
               <div className="flex-1">
                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {sortedFilament.map(f => {
                       const hex = resolveColorHex(f.color, colorDefs);
                       const isLight = isLightColor(hex);
                       
                       const grams = f.weightGrams;
                       const absGrams = Math.abs(grams);
                       
                       // Change: Always display as kg with 2 decimals
                       const displayWeight = (absGrams / 1000).toFixed(2);
                       const unit = 'кг';
                       
                       // Determine status color
                       let statusClass = "border-slate-200";
                       let textClass = "text-slate-900";
                       let isNegative = grams < 0;

                       if (isNegative) {
                          statusClass = "border-red-500 bg-red-100 ring-2 ring-red-200";
                          textClass = "text-red-800";
                       } else if (grams < 300) {
                          statusClass = "border-amber-300 bg-amber-50";
                          textClass = "text-amber-900";
                       } else {
                          statusClass = "border-slate-200 bg-white";
                       }

                       return (
                         <div key={`${f.color}-${f.type}`} className={`relative group rounded-xl border p-5 flex items-center gap-4 shadow-sm transition-all ${statusClass}`}>
                             {onDeleteFilament && (
                               <button
                                 onClick={() => onDeleteFilament(f.color, f.type)}
                                 className="absolute top-2 right-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
                                 title="Удалить позицию"
                               >
                                 <Trash2 size={18} />
                               </button>
                             )}
                             
                             <div 
                                className="w-16 h-16 rounded-full border-4 shadow-sm flex items-center justify-center text-xs font-bold shrink-0"
                                style={{ backgroundColor: hex, borderColor: isLight ? '#cbd5e1' : hex, color: getTextColor(hex) }}
                             >
                                {f.type}
                             </div>
                             <div className="min-w-0 flex-1">
                                <h3 className={`text-xl font-bold ${textClass} truncate pr-8`}>{f.color}</h3>
                                <div className={`text-3xl font-extrabold ${textClass} mt-1 flex items-baseline gap-1`}>
                                   {isNegative && <span>-</span>}
                                   {displayWeight}
                                   <span className="text-sm opacity-70 font-bold">{unit}</span>
                                </div>
                                <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${isNegative ? 'text-red-600' : 'text-slate-400'}`}>
                                   {isNegative ? (
                                      <>
                                        <AlertTriangle size={12} />
                                        Дефицит: {(absGrams/1000).toFixed(2)} кг
                                      </>
                                   ) : (
                                      <>Остаток: {(grams/1000).toFixed(2)} кг</>
                                   )}
                                </div>
                             </div>
                         </div>
                       )
                    })}
                    {sortedFilament.length === 0 && (
                       <div className="col-span-full text-center text-slate-400 py-10 opacity-70">
                          <BoxSelect size={48} className="mx-auto mb-2"/>
                          Нет данных о филаменте
                       </div>
                    )}
                 </div>
               </div>

               {/* Add/Deduct Form */}
               {onAddFilament && (
                 <div className="w-full lg:w-96 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
                    <div className="bg-slate-100 p-1 rounded-xl flex mb-6">
                        <button 
                           onClick={() => setFilamentAction('ADD')}
                           className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${filamentAction === 'ADD' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                           <ArrowDown size={16} /> Приход
                        </button>
                        <button 
                           onClick={() => setFilamentAction('DEDUCT')}
                           className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${filamentAction === 'DEDUCT' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                           <ArrowUp size={16} /> Списание
                        </button>
                    </div>

                    <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                       {filamentAction === 'ADD' ? (
                          <><Plus size={20} className="text-emerald-600"/> Добавить филамент</>
                       ) : (
                          <><MinusCircle size={20} className="text-red-600"/> Списать филамент</>
                       )}
                    </h3>
                    
                    <div className="space-y-4">
                       <div>
                          <label className="block text-sm font-bold text-slate-500 mb-1">Цвет</label>
                          <select 
                             className="w-full p-3 border border-slate-300 rounded-xl bg-white font-medium"
                             value={newFilamentColor}
                             onChange={e => setNewFilamentColor(e.target.value)}
                          >
                             {colorDefs.map(c => (
                               <option key={c.name} value={c.name}>{c.name}</option>
                             ))}
                          </select>
                       </div>
                       
                       <div className="flex gap-4">
                          <div className="flex-1">
                             <label className="block text-sm font-bold text-slate-500 mb-1">Тип</label>
                             <input 
                               type="text" 
                               className="w-full p-3 border border-slate-300 rounded-xl bg-white font-medium"
                               value={newFilamentType}
                               onChange={e => setNewFilamentType(e.target.value)}
                               placeholder="PLA"
                             />
                          </div>
                          <div className="flex-1">
                             <label className="block text-sm font-bold text-slate-500 mb-1">Вес (г)</label>
                             <input 
                               type="number" 
                               className="w-full p-3 border border-slate-300 rounded-xl bg-white font-medium"
                               value={newFilamentWeight}
                               onChange={e => setNewFilamentWeight(parseInt(e.target.value) || 0)}
                               step={100}
                               min={0}
                             />
                          </div>
                       </div>
                       
                       <button 
                         onClick={() => {
                            if(newFilamentColor && newFilamentType && newFilamentWeight > 0) {
                               // If deducting, send negative value
                               const weightChange = filamentAction === 'ADD' ? newFilamentWeight : -newFilamentWeight;
                               onAddFilament(newFilamentColor, newFilamentType, weightChange);
                               
                               // Reset slightly but keep color/type for rapid entry
                               setNewFilamentWeight(1000); 
                            }
                         }}
                         className={`w-full text-white font-bold py-3 rounded-xl transition-all mt-2 active:scale-95 shadow-md ${filamentAction === 'ADD' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-red-600 hover:bg-red-700 shadow-red-200'}`}
                       >
                          {filamentAction === 'ADD' ? 'Добавить на склад' : 'Списать со склада'}
                       </button>
                    </div>
                 </div>
               )}
             </div>
          )}
       </div>
    </div>
  );
};
