


import React, { useState, useMemo, useEffect } from 'react';
import { Printer, ProductTemplate, Plate, ColorDef } from '../types';
import { Trash2, Plus, X, Pencil, Layers, Clock, Image as ImageIcon, Upload, Check, Palette, Wrench, Search, Library, Scale, Copy, Minus, Save, Percent, Download, Database } from 'lucide-react';
import { resolveColorHex, getTextColor, isLightColor } from '../constants';

interface Props {
  colors: ColorDef[];
  printers: Printer[];
  templates: ProductTemplate[];
  globalParts?: Plate[]; // New: Library of all parts
  wastePercentage?: number;
  onSaveWastePercentage?: (val: number) => void;
  onAddColor: (name: string, hex: string, printerIds: string[]) => void;
  onDeleteColor: (name: string) => void;
  onAddPrinter: (p: Printer) => void;
  onUpdatePrinter: (p: Printer) => void;
  onDeletePrinter: (id: string) => void;
  onAddTemplate: (t: ProductTemplate) => void;
  onUpdateTemplate: (t: ProductTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onSaveGlobalPart?: (p: Plate) => void; // New
  onExportData?: () => void;
  onImportData?: (file: File) => void;
}

const PRESET_PALETTE = [
  { name: 'Черный', hex: '#1f2937' },
  { name: 'Белый', hex: '#ffffff' },
  { name: 'Серый', hex: '#9ca3af' },
  { name: 'Синий', hex: '#2563eb' },
  { name: 'Красный', hex: '#dc2626' },
  { name: 'Зеленый', hex: '#16a34a' },
  { name: 'Желтый', hex: '#eab308' },
  { name: 'Оранжевый', hex: '#f97316' },
  { name: 'Фиолетовый', hex: '#9333ea' },
  { name: 'Розовый', hex: '#db2777' },
  { name: 'Бирюзовый', hex: '#2dd4bf' },
  { name: 'Салатовый', hex: '#a3e635' },
  { name: 'Золотой', hex: '#ca8a04' },
  { name: 'Серебряный', hex: '#cbd5e1' },
  { name: 'Коричневый', hex: '#78350f' },
  { name: 'Бежевый', hex: '#f5f5dc' },
  { name: 'Хаки', hex: '#c3b091' },
  { name: 'Бордовый', hex: '#991b1b' },
  { name: 'Натуральный', hex: '#fffdd0' },
  { name: 'Светящийся', hex: '#ccff00' },
  { name: 'Прозрачный', hex: '#e2e8f0' },
];

// Helper to strip potentially circular or extra properties
const sanitizePlate = (p: any): Plate => ({
  id: typeof p.id === 'string' ? p.id : `pl-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
  name: typeof p.name === 'string' ? p.name : '',
  photoUrl: typeof p.photoUrl === 'string' ? p.photoUrl : '', // Ensure string to avoid DOM ref circular errors
  printTimeMinutes: Number(p.printTimeMinutes) || 0,
  filamentType: typeof p.filamentType === 'string' ? p.filamentType : 'PLA',
  colors: Array.isArray(p.colors) ? p.colors.filter((c: any) => typeof c === 'string') : [],
  filamentUsage: Array.isArray(p.filamentUsage) ? p.filamentUsage.map((u: any) => Number(u) || 0) : []
});

// Image Compression Utility
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
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
            // Compress to JPEG with 60% quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            resolve(dataUrl);
        } else {
            reject(new Error("Canvas context failed"));
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export const SettingsTab: React.FC<Props> = ({
  colors,
  printers,
  templates,
  globalParts = [],
  wastePercentage = 0,
  onSaveWastePercentage,
  onAddColor,
  onDeleteColor,
  onAddPrinter,
  onUpdatePrinter,
  onDeletePrinter,
  onAddTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onSaveGlobalPart,
  onExportData,
  onImportData
}) => {
  // --- Local State for Forms ---
  
  // Color Modal State
  const [showColorModal, setShowColorModal] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#2563eb');
  const [newColorPrinterIds, setNewColorPrinterIds] = useState<string[]>([]);
  
  // Printer Form State
  const [showPrinterForm, setShowPrinterForm] = useState(false);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterMulti, setNewPrinterMulti] = useState(false);
  const [newPrinterMaintenance, setNewPrinterMaintenance] = useState(false);
  const [newPrinterColors, setNewPrinterColors] = useState<string[]>([]);

  // Template Form State
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  
  const [newTplName, setNewTplName] = useState('');
  const [newTplPhoto, setNewTplPhoto] = useState('');
  const [newTplAssembleTime, setNewTplAssembleTime] = useState('');
  const [newTplPackTime, setNewTplPackTime] = useState('');
  
  // Plates Management (Inside Template)
  const [newTplPlates, setNewTplPlates] = useState<Plate[]>([]);
  
  // New Plate / Part Form State
  const [partSearchTerm, setPartSearchTerm] = useState('');
  const [showCreatePartForm, setShowCreatePartForm] = useState(false);
  
  const [plateName, setPlateName] = useState('');
  const [originalPlateName, setOriginalPlateName] = useState(''); // To track renaming
  const [plateTime, setPlateTime] = useState('');
  const [platePhoto, setPlatePhoto] = useState('');
  const [plateFilament, setPlateFilament] = useState('PLA');
  const [plateColors, setPlateColors] = useState<string[]>([]);
  const [plateFilamentUsages, setPlateFilamentUsages] = useState<number[]>([]); // Array of weights

  const [editingPlateId, setEditingPlateId] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // General Settings State
  const [localWaste, setLocalWaste] = useState(wastePercentage);

  useEffect(() => {
    setLocalWaste(wastePercentage);
  }, [wastePercentage]);

  // --- Handlers ---

  const handleSaveGeneralSettings = () => {
     if (onSaveWastePercentage) {
         onSaveWastePercentage(localWaste);
     }
  };

  const openAddColorModal = () => {
    setNewColorName('');
    setNewColorHex('#2563eb');
    setNewColorPrinterIds(printers.map(p => p.id)); // Default: All printers
    setShowColorModal(true);
  };

  const handleSaveColor = () => {
    if (newColorName.trim()) {
      onAddColor(newColorName.trim(), newColorHex, newColorPrinterIds);
      setShowColorModal(false);
      setNewColorName('');
    }
  };

  const togglePrinterForNewColor = (printerId: string) => {
    setNewColorPrinterIds(prev => 
      prev.includes(printerId) 
        ? prev.filter(id => id !== printerId) 
        : [...prev, printerId]
    );
  };

  const openAddPrinterModal = () => {
    setEditingPrinterId(null);
    setNewPrinterName('');
    setNewPrinterMulti(false);
    setNewPrinterMaintenance(false);
    setNewPrinterColors([]);
    setShowPrinterForm(true);
  };

  const openEditPrinterModal = (printer: Printer) => {
    setEditingPrinterId(printer.id);
    setNewPrinterName(printer.name);
    setNewPrinterMulti(printer.isMultiColor);
    setNewPrinterMaintenance(printer.isMaintenance || false);
    setNewPrinterColors(printer.supportedColors);
    setShowPrinterForm(true);
  };

  const handleSavePrinter = () => {
    if (!newPrinterName.trim()) return;
    
    const printer: Printer = {
      id: editingPrinterId || `p-${Date.now()}`,
      name: newPrinterName,
      isMultiColor: newPrinterMulti,
      isMaintenance: newPrinterMaintenance,
      supportedColors: newPrinterColors.length > 0 ? newPrinterColors : colors.map(c => c.name)
    };

    if (editingPrinterId) {
      onUpdatePrinter(printer);
    } else {
      onAddPrinter(printer);
    }
    
    setNewPrinterName('');
    setNewPrinterMulti(false);
    setNewPrinterMaintenance(false);
    setNewPrinterColors([]);
    setShowPrinterForm(false);
  };

  const openAddTemplateModal = () => {
    setEditingTemplateId(null);
    setNewTplName('');
    setNewTplPhoto('');
    setNewTplAssembleTime('');
    setNewTplPackTime('');
    setNewTplPlates([]);
    setPartSearchTerm('');
    setShowCreatePartForm(false);
    resetPlateForm();
    setShowTemplateForm(true);
  };

  const openEditTemplateModal = (t: ProductTemplate) => {
    setEditingTemplateId(t.id);
    setNewTplName(t.name);
    setNewTplPhoto(t.photoUrl);
    setNewTplAssembleTime(t.assemblyTimeMinutes.toString());
    setNewTplPackTime(t.packingTimeMinutes.toString());
    
    // Sanitize loaded plates immediately
    const parsedPlates = (t.plates || []).map((p: any) => ({
      ...sanitizePlate(p),
      colors: p.colors || (p.color ? [p.color] : [])
    }));
    
    setNewTplPlates(parsedPlates); 
    setPartSearchTerm('');
    setShowCreatePartForm(false);
    resetPlateForm();
    setShowTemplateForm(true);
  };

  const resetPlateForm = () => {
    setPlateName('');
    setOriginalPlateName('');
    setPlateTime('');
    setPlatePhoto('');
    setPlateFilament('PLA');
    setPlateColors([]);
    setPlateFilamentUsages([]);
    setEditingPlateId(null);
  };

  const handleEditPlate = (plate: Plate) => {
    const clean = sanitizePlate(plate);
    setEditingPlateId(clean.id);
    setPlateName(clean.name);
    setOriginalPlateName(clean.name); // Track original name
    setPlateTime(clean.printTimeMinutes.toString());
    setPlatePhoto(clean.photoUrl);
    setPlateFilament(clean.filamentType);
    setPlateColors(clean.colors || []);
    setPlateFilamentUsages(clean.filamentUsage || []);
    setShowCreatePartForm(true); // Open the form in edit mode
  };

  const handleCreateAndAddPart = () => {
    if (!plateName.trim() || !plateTime) return;
    
    // Check for duplicates in Global Parts
    const normalizedName = plateName.trim().toLowerCase();
    const existingGlobalPart = globalParts.find(p => p.name.trim().toLowerCase() === normalizedName);
    
    // Validation
    if (existingGlobalPart) {
        if (!editingPlateId) {
             alert('Деталь с таким названием уже существует в библиотеке!');
             return;
        }
        if (plateName.trim() !== originalPlateName.trim()) {
             alert('Деталь с таким названием уже существует в библиотеке!');
             return;
        }
    }

    // Ensure usages array matches colors length
    const normalizedUsages = plateColors.length > 0 
       ? plateColors.map((_, idx) => plateFilamentUsages[idx] || 0)
       : [plateFilamentUsages[0] || 0];
    
    let finalId = editingPlateId || `part-${Date.now()}`;
    if (existingGlobalPart) {
        finalId = existingGlobalPart.id;
    }

    const partData: Plate = sanitizePlate({
        id: finalId, 
        name: plateName,
        printTimeMinutes: parseFloat(plateTime) || 0,
        photoUrl: platePhoto,
        filamentType: plateFilament,
        colors: plateColors.length > 0 ? plateColors : undefined,
        filamentUsage: normalizedUsages
    });

    // 1. Save to Global Library
    if (onSaveGlobalPart) {
        onSaveGlobalPart(partData);
    }

    // 2. Add/Update Template List
    if (editingPlateId) {
       setNewTplPlates(prev => prev.map(p => p.id === editingPlateId ? partData : p));
    } else {
       const templateInstance: Plate = {
           ...partData,
           id: `pl-${Date.now()}-${Math.random().toString(36).substring(2,9)}`
       };
       setNewTplPlates([...newTplPlates, templateInstance]);
    }
    
    resetPlateForm();
    setShowCreatePartForm(false);
  };

  // New function to fork/clone a part
  const handleSaveAsNewPart = () => {
    if (!plateName.trim() || !plateTime) return;
    
    // STRICT Check: If saving as NEW, name must not exist globally
    const normalizedName = plateName.trim().toLowerCase();
    if (globalParts.some(p => p.name.trim().toLowerCase() === normalizedName)) {
        alert('Деталь с таким названием уже существует в библиотеке! Измените название.');
        return;
    }

    const normalizedUsages = plateColors.length > 0 
       ? plateColors.map((_, idx) => plateFilamentUsages[idx] || 0)
       : [plateFilamentUsages[0] || 0];

    const newGlobalPartId = `part-${Date.now()}`;

    const partData: Plate = sanitizePlate({
        id: newGlobalPartId, 
        name: plateName,
        printTimeMinutes: parseFloat(plateTime) || 0,
        photoUrl: platePhoto,
        filamentType: plateFilament,
        colors: plateColors.length > 0 ? plateColors : undefined,
        filamentUsage: normalizedUsages
    });

    if (onSaveGlobalPart) {
        onSaveGlobalPart(partData);
    }

    const templateInstance: Plate = {
        ...partData,
        id: `pl-${Date.now()}-${Math.random().toString(36).substring(2,9)}`
    };

    if (editingPlateId) {
       setNewTplPlates(prev => prev.map(p => p.id === editingPlateId ? templateInstance : p));
    } else {
       setNewTplPlates([...newTplPlates, templateInstance]);
    }
    
    resetPlateForm();
    setShowCreatePartForm(false);
  };

  // Add an existing global part to the template
  const handleAddGlobalPartToTemplate = (part: Plate) => {
      const clean = sanitizePlate(part);
      const templateInstance: Plate = {
          ...clean,
          id: `pl-${Date.now()}-${Math.random().toString(36).substring(2,9)}`
      };
      setNewTplPlates([...newTplPlates, templateInstance]);
  };

  const handleSaveTemplate = () => {
    if (!newTplName.trim()) return;
    
    // Final sanitization of all plates
    const cleanPlates = newTplPlates.map(sanitizePlate);

    const totalPrintTime = cleanPlates.length > 0
      ? cleanPlates.reduce((acc, p) => acc + p.printTimeMinutes, 0)
      : 0;

    const tplData: ProductTemplate = {
      id: editingTemplateId || `t-${Date.now()}`,
      name: newTplName,
      photoUrl: newTplPhoto || '',
      printTimeMinutes: totalPrintTime,
      assemblyTimeMinutes: parseFloat(newTplAssembleTime) || 0,
      packingTimeMinutes: parseFloat(newTplPackTime) || 0,
      preferredPrinterIds: [],
      defaultColors: [],
      plates: cleanPlates
    };

    if (editingTemplateId) {
      onUpdateTemplate(tplData);
    } else {
      onAddTemplate(tplData);
    }
    
    setShowTemplateForm(false);
  };

  const toggleColorSelection = (colorName: string, currentList: string[], setter: (l: string[]) => void) => {
    if (currentList.includes(colorName)) {
      setter(currentList.filter(c => c !== colorName));
    } else {
      setter([...currentList, colorName]);
    }
  };
  
  const updateFilamentUsage = (index: number, val: string) => {
      const numVal = parseFloat(val) || 0;
      const newUsages = [...plateFilamentUsages];
      newUsages[index] = numVal;
      setPlateFilamentUsages(newUsages);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, onComplete: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        setIsProcessingImage(true);
        // Use the compression utility
        const compressedBase64 = await compressImage(file);
        onComplete(compressedBase64);
    } catch (err) {
        console.error("Image compression failed", err);
        alert("Ошибка обработки изображения. Попробуйте другой файл.");
    } finally {
        setIsProcessingImage(false);
    }
  };

  const totalCalculatedPrintTime = newTplPlates.reduce((acc, p) => acc + (Number(p.printTimeMinutes)||0), 0);

  // Group identical plates for display using a robust signature to ensure identical parts are merged
  const groupedPlates = useMemo(() => {
    const groups: { signature: string; plate: Plate; ids: string[] }[] = [];
    newTplPlates.forEach(p => {
         if (!p || typeof p !== 'object') return; // Safety check for malformed state

         const nameNorm = (p.name || '').trim();
         const timeNorm = (Number(p.printTimeMinutes) || 0).toFixed(4);
         const typeNorm = (p.filamentType || '').trim();
         const colorStr = (p.colors || []).map(c => typeof c === 'string' ? c.trim() : '').sort().join(',');
         const usageStr = (p.filamentUsage || []).map(u => (Number(u) || 0).toFixed(4)).join(',');
         
         const signature = `${nameNorm}|${timeNorm}|${typeNorm}|${colorStr}|${usageStr}`;
         
         const existing = groups.find(g => g.signature === signature);
         if (existing) {
             existing.ids.push(p.id);
         } else {
             // Store a clean copy of the plate for the group representative
             groups.push({ signature, plate: sanitizePlate(p), ids: [p.id] });
         }
    });
    return groups;
  }, [newTplPlates]);

  const handleIncreasePlateCount = (plate: Plate) => {
     // Deep copy to ensure no circular references or shared arrays
     const clean = sanitizePlate(plate);
     const copy: Plate = {
         ...clean,
         id: `pl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
         colors: clean.colors ? [...clean.colors] : [],
         filamentUsage: clean.filamentUsage ? [...clean.filamentUsage] : []
     };
     setNewTplPlates(prev => [...prev, copy]);
  };

  const handleDecreasePlateCount = (ids: string[]) => {
     if (ids.length === 0) return;
     // Remove the last added instance (last ID in the group list)
     const idToRemove = ids[ids.length - 1];
     setNewTplPlates(prev => prev.filter(p => p.id !== idToRemove));
     
     if (editingPlateId === idToRemove) {
        resetPlateForm();
        setShowCreatePartForm(false);
     }
  };

  const handleDeletePlateGroup = (ids: string[]) => {
     setNewTplPlates(prev => prev.filter(p => !ids.includes(p.id)));
     if (editingPlateId && ids.includes(editingPlateId)) {
        resetPlateForm();
        setShowCreatePartForm(false);
     }
  };

  // Deduplicate and sort global parts for the library view
  const uniqueGlobalParts = useMemo(() => {
    const seen = new Set<string>();
    const unique: Plate[] = [];
    const sorted = [...globalParts].sort((a, b) => a.name.localeCompare(b.name));
    
    for (const p of sorted) {
      const norm = p.name.trim().toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        unique.push(p);
      }
    }
    return unique;
  }, [globalParts]);

  const filteredGlobalParts = uniqueGlobalParts.filter(p => 
      p.name.toLowerCase().includes(partSearchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-8 space-y-12 pb-24">
      <h2 className="text-3xl font-bold text-slate-800 mb-6">Настройки базы данных</h2>

      {/* --- DATABASE MANAGEMENT (MOVED TO TOP) --- */}
      <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
         <div className="flex items-start justify-between mb-6">
             <div>
                <h3 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <Database size={24} className="text-indigo-600" />
                    1. База данных
                </h3>
                <p className="text-slate-500 text-lg">Экспорт и импорт всех данных системы (включая картинки).</p>
             </div>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {onExportData && (
                 <button 
                    onClick={onExportData}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 p-6 rounded-xl flex items-center gap-4 transition-all shadow-sm active:scale-95 group"
                 >
                    <div className="bg-white p-3 rounded-lg shadow-sm group-hover:scale-110 transition-transform">
                        <Download size={32} className="text-indigo-600" />
                    </div>
                    <div className="text-left">
                        <div className="text-xl font-bold">Скачать полную БД</div>
                        <div className="text-sm opacity-75">JSON файл со всеми данными и картинками</div>
                    </div>
                 </button>
             )}
             
             {onImportData && (
                 <label className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 p-6 rounded-xl flex items-center gap-4 transition-all shadow-sm active:scale-95 cursor-pointer group">
                    <div className="bg-white p-3 rounded-lg shadow-sm group-hover:scale-110 transition-transform">
                        <Upload size={32} className="text-slate-600" />
                    </div>
                    <div className="text-left">
                        <div className="text-xl font-bold">Восстановить из файла</div>
                        <div className="text-sm opacity-75">Загрузить ранее скачанный JSON</div>
                    </div>
                    <input 
                        type="file" 
                        accept=".json" 
                        className="hidden" 
                        onChange={(e) => {
                            if (e.target.files?.[0]) {
                                onImportData(e.target.files[0]);
                            }
                        }}
                    />
                 </label>
             )}
         </div>
      </section>

      {/* --- GENERAL SETTINGS SECTION (NEW) --- */}
      {onSaveWastePercentage && (
         <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
             <div className="flex items-start justify-between">
                 <div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-2">Общие настройки</h3>
                    <p className="text-slate-500 text-lg">Параметры производства.</p>
                 </div>
                 <button 
                    onClick={handleSaveGeneralSettings}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-md shadow-indigo-100 active:scale-95"
                 >
                    <Save size={18} /> Сохранить
                 </button>
             </div>
             
             <div className="mt-6 max-w-md">
                 <label className="block font-bold text-slate-700 mb-2 flex items-center gap-2">
                    <Percent size={18} className="text-indigo-500"/> Процент брака / отходов
                 </label>
                 <div className="flex items-center gap-4">
                     <div className="relative flex-1">
                        <input 
                           type="number" 
                           min="0" 
                           max="100" 
                           step="1"
                           value={localWaste}
                           onChange={e => setLocalWaste(parseFloat(e.target.value) || 0)}
                           className="w-full pl-4 pr-12 py-3 bg-white border border-slate-300 rounded-xl text-lg font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                     </div>
                     <div className="text-sm text-slate-500 flex-1 leading-snug">
                         Этот процент будет добавлен к весу филамента при списании со склада. 
                         <br/>
                         <span className="text-xs opacity-75">(Пример: 100г + 10% = 110г списано)</span>
                     </div>
                 </div>
             </div>
         </section>
      )}

      {/* --- COLORS SECTION --- */}
      <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-2xl font-bold text-slate-800 mb-4">2. Цвета</h3>
        <p className="text-slate-500 mb-4 text-lg">Доступные цвета пластика для выбора в заказах и принтерах.</p>
        
        <div className="flex flex-wrap gap-3 mb-6">
          {colors.map(c => {
             const hex = c.hex;
             const isLight = isLightColor(hex);
             return (
              <div key={c.name} className="flex items-center gap-2 bg-slate-50 pl-3 pr-2 py-2 rounded-lg border border-slate-200 shadow-sm transition-all hover:border-slate-300">
                <span 
                  className="w-6 h-6 rounded-full border shadow-sm" 
                  style={{ backgroundColor: hex, borderColor: isLight ? '#cbd5e1' : hex }} 
                />
                <span className="font-bold text-slate-700 text-lg mr-1">{c.name}</span>
                <button 
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteColor(c.name);
                  }} 
                  className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors cursor-pointer"
                  title="Удалить цвет"
                  aria-label={`Удалить цвет ${c.name}`}
                >
                  <X size={20} strokeWidth={2.5} />
                </button>
              </div>
            );
          })}
        </div>

        <div>
           <button 
             onClick={openAddColorModal}
             className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-colors"
           >
             <Plus size={20} /> Добавить цвет
           </button>
        </div>

        {/* Create Color Modal */}
        {showColorModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowColorModal(false)}>
             <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                   <h3 className="text-2xl font-bold">Добавить новый цвет</h3>
                   <button onClick={() => setShowColorModal(false)} className="text-slate-400 hover:text-slate-600">
                      <X size={24} />
                   </button>
                </div>
                
                <div className="space-y-6">
                   <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block font-bold text-slate-700 mb-2">Название цвета</label>
                        <input 
                          type="text" 
                          value={newColorName}
                          onChange={e => setNewColorName(e.target.value)}
                          placeholder="Например: Золотой"
                          className="w-full p-3 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-2">Цвет</label>
                        <div className="h-[52px] w-[60px] relative overflow-hidden rounded-lg border border-slate-300 shadow-sm">
                          <input 
                            type="color" 
                            value={newColorHex}
                            onChange={e => setNewColorHex(e.target.value)}
                            className="absolute -top-2 -left-2 w-[200%] h-[200%] cursor-pointer p-0 border-0"
                          />
                        </div>
                      </div>
                   </div>

                   {/* Quick Select Palette */}
                   <div>
                      <label className="block font-bold text-slate-700 mb-2 flex items-center gap-2">
                         <Palette size={16} /> Быстрый выбор (Палитра)
                      </label>
                      <div className="flex flex-wrap gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl justify-center">
                        {PRESET_PALETTE.map(p => {
                           const isLight = isLightColor(p.hex);
                           const isSelected = newColorHex.toLowerCase() === p.hex.toLowerCase();
                           return (
                             <button
                               key={p.name}
                               type="button"
                               onClick={() => {
                                  setNewColorName(p.name);
                                  setNewColorHex(p.hex);
                               }}
                               className={`
                                 w-10 h-10 rounded-full border-2 transition-all hover:scale-110 active:scale-95 group relative shadow-sm
                                 ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-2 scale-110' : ''}
                               `}
                               style={{ backgroundColor: p.hex, borderColor: isLight ? '#cbd5e1' : p.hex }}
                               title={p.name}
                             >
                               {isSelected && (
                                 <span className="absolute inset-0 flex items-center justify-center">
                                    <Check size={18} className={isLight ? 'text-slate-800' : 'text-white'} strokeWidth={3} />
                                 </span>
                               )}
                             </button>
                           );
                        })}
                      </div>
                   </div>

                   <div>
                      <div className="flex justify-between items-end mb-2">
                        <label className="block font-bold text-slate-700">Доступен на принтерах</label>
                        <button 
                           onClick={() => setNewColorPrinterIds(newColorPrinterIds.length === printers.length ? [] : printers.map(p => p.id))}
                           className="text-indigo-600 text-sm font-bold hover:underline"
                        >
                           {newColorPrinterIds.length === printers.length ? 'Снять все' : 'Выбрать все'}
                        </button>
                      </div>
                      
                      <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-1 bg-slate-50">
                         {printers.length === 0 && <div className="text-slate-400 text-center py-4">Нет принтеров</div>}
                         {printers.map(p => (
                            <label key={p.id} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-200 select-none">
                               <input 
                                 type="checkbox" 
                                 checked={newColorPrinterIds.includes(p.id)}
                                 onChange={() => togglePrinterForNewColor(p.id)}
                                 className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                               />
                               <span className="font-bold text-slate-700">{p.name}</span>
                               <div className="ml-auto flex gap-1">
                                 {p.isMultiColor && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded uppercase font-bold">Multi</span>}
                               </div>
                            </label>
                         ))}
                      </div>
                   </div>
                </div>

                <div className="flex gap-4 mt-8 pt-4 border-t border-slate-100">
                  <button onClick={() => setShowColorModal(false)} className="flex-1 py-3 text-lg font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Отмена</button>
                  <button 
                    onClick={handleSaveColor} 
                    disabled={!newColorName.trim()}
                    className="flex-1 py-3 text-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors shadow-lg shadow-indigo-200"
                  >
                    Создать
                  </button>
                </div>
             </div>
          </div>
        )}
      </section>

      {/* --- PRINTERS SECTION --- */}
      <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-6">
           <div>
             <h3 className="text-2xl font-bold text-slate-800">3. Принтеры</h3>
             <p className="text-slate-500 text-lg">Оборудование вашей фермы.</p>
           </div>
           <button 
             onClick={openAddPrinterModal}
             className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors"
           >
             <Plus size={20} /> Добавить принтер
           </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {printers.map(p => (
            <div key={p.id} className="border border-slate-200 rounded-xl p-5 relative group bg-white">
               <div className="absolute top-2 right-2 flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                 <button 
                   onClick={() => openEditPrinterModal(p)}
                   className="text-slate-400 hover:text-indigo-600 transition-colors p-2"
                   title="Редактировать"
                 >
                   <Pencil size={20} />
                 </button>
                 <button 
                   onClick={() => onDeletePrinter(p.id)}
                   className="text-slate-400 hover:text-red-600 transition-colors p-2"
                   title="Удалить"
                 >
                   <Trash2 size={20} />
                 </button>
               </div>
               
               <h4 className="font-bold text-xl text-slate-800">{p.name}</h4>
               <div className="mt-2 flex gap-2">
                 <span className={`text-sm font-bold px-2 py-1 rounded border ${p.isMultiColor ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                   {p.isMultiColor ? 'Multi-Color' : 'Single Color'}
                 </span>
                 {p.isMaintenance && (
                   <span className="text-sm bg-red-100 text-red-700 px-2 py-1 rounded border border-red-200 font-bold flex items-center gap-1">
                     <Wrench size={12} /> Ремонт
                   </span>
                 )}
               </div>
               <div className="mt-4 flex flex-wrap gap-1.5">
                 {p.supportedColors.map(c => {
                   const hex = resolveColorHex(c, colors);
                   const isLight = isLightColor(hex);
                   return (
                   <span 
                    key={c} 
                    className="flex items-center gap-1.5 text-xs border px-2 py-1 rounded-lg font-bold shadow-sm"
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
          ))}
        </div>

        {/* Add/Edit Printer Modal/Form */}
        {showPrinterForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl">
              <h3 className="text-2xl font-bold mb-6">
                {editingPrinterId ? 'Редактировать принтер' : 'Новый принтер'}
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-2">Название</label>
                  <input 
                    type="text" 
                    value={newPrinterName}
                    onChange={e => setNewPrinterName(e.target.value)}
                    className="w-full p-3 border border-slate-300 rounded-lg text-lg bg-white"
                  />
                </div>
                
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="multi" 
                    checked={newPrinterMulti}
                    onChange={e => setNewPrinterMulti(e.target.checked)}
                    className="w-6 h-6 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="multi" className="text-lg font-medium text-slate-700">Поддерживает многоцветную печать</label>
                </div>

                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="maintenance" 
                    checked={newPrinterMaintenance}
                    onChange={e => setNewPrinterMaintenance(e.target.checked)}
                    className="w-6 h-6 text-red-600 rounded focus:ring-red-500"
                  />
                  <label htmlFor="maintenance" className="text-lg font-medium text-slate-700 flex items-center gap-2">
                     <Wrench size={18} className="text-red-500" /> На ремонте (скрыть из печати)
                  </label>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-2">Доступные цвета</label>
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border rounded-lg bg-white">
                    {colors.map(c => {
                      const hex = c.hex;
                      const isLight = isLightColor(hex);
                      return (
                      <button
                        key={c.name}
                        onClick={() => toggleColorSelection(c.name, newPrinterColors, setNewPrinterColors)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-bold transition-transform active:scale-95 shadow-sm
                          ${newPrinterColors.includes(c.name) ? 'ring-2 ring-slate-400 scale-105' : 'opacity-90'}
                        `}
                        style={{
                          backgroundColor: hex,
                          color: getTextColor(hex),
                          borderColor: isLight ? '#cbd5e1' : hex
                        }}
                      >
                         {newPrinterColors.includes(c.name) && <Check size={14} />}
                        {c.name}
                      </button>
                    )})}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button onClick={() => setShowPrinterForm(false)} className="flex-1 py-3 text-lg font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Отмена</button>
                <button onClick={handleSavePrinter} className="flex-1 py-3 text-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl">
                  {editingPrinterId ? 'Сохранить изменения' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* --- TEMPLATES SECTION --- */}
      <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
         <div className="flex justify-between items-center mb-6">
           <div>
             <h3 className="text-2xl font-bold text-slate-800">4. Товары (Шаблоны)</h3>
             <p className="text-slate-500 text-lg">Каталог изделий для печати.</p>
           </div>
           <button 
             onClick={openAddTemplateModal}
             className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors"
           >
             <Plus size={20} /> Добавить товар
           </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {templates.map(t => (
             <div key={t.id} className="flex gap-4 border border-slate-200 rounded-xl p-4 bg-white relative group">
               <div className="absolute top-2 right-2 flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm">
                 <button 
                   onClick={() => openEditTemplateModal(t)}
                   className="text-slate-400 hover:text-indigo-600 transition-colors p-2"
                   title="Редактировать"
                 >
                   <Pencil size={20} />
                 </button>
                 <button 
                   onClick={() => onDeleteTemplate(t.id)}
                   className="text-slate-400 hover:text-red-600 transition-colors p-2"
                   title="Удалить"
                 >
                   <Trash2 size={20} />
                 </button>
               </div>
               
               <img src={t.photoUrl || 'https://via.placeholder.com/150'} alt="" className="w-24 h-24 object-cover rounded-lg bg-white border border-slate-200 flex-shrink-0" />
               <div className="flex-1 min-w-0 pr-16">
                 <h4 className="font-bold text-xl text-slate-800 leading-tight truncate">{t.name}</h4>
                 <div className="text-sm text-slate-500 mt-2 space-y-1">
                   <p className="flex items-center gap-1"><Clock size={14}/> Печать: <span className="font-bold text-slate-700">{Number(t.printTimeMinutes.toFixed(2))} мин</span></p>
                   {t.plates && t.plates.length > 0 && (
                      <p className="flex items-center gap-1 text-indigo-600 font-bold">
                        <Layers size={14}/> {t.plates.length} деталей
                      </p>
                   )}
                   <div className="flex gap-2 text-xs pt-1">
                     <span title="Сборка">🔨 {t.assemblyTimeMinutes}m</span>
                     <span title="Упаковка">📦 {t.packingTimeMinutes}m</span>
                   </div>
                 </div>
               </div>
             </div>
          ))}
        </div>

        {/* Template Modal (Add/Edit) */}
        {showTemplateForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
             <div className="bg-white rounded-2xl p-8 w-full max-w-7xl shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col">
               <div className="flex justify-between items-center mb-6">
                 <h3 className="text-2xl font-bold">
                   {editingTemplateId ? 'Редактировать товар' : 'Новый товар'}
                 </h3>
                 <button onClick={() => setShowTemplateForm(false)} className="text-slate-400 hover:text-slate-600">
                   <X size={32} />
                 </button>
               </div>
               
               <div className="flex-1 overflow-y-auto pr-2">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   {/* Left Col: Basic Info */}
                   <div className="space-y-4">
                      <h4 className="text-lg font-bold text-slate-800 border-b pb-2 mb-4">Основная информация</h4>
                      <div>
                        <label className="block font-bold text-slate-700 mb-2">Название</label>
                        <input 
                          type="text" 
                          value={newTplName} 
                          onChange={e => setNewTplName(e.target.value)} 
                          className="w-full p-3 border border-slate-300 rounded-lg bg-white" 
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-2">Фото товара</label>
                        <div className="flex items-center gap-4">
                          {newTplPhoto ? (
                             <img src={newTplPhoto} className="w-20 h-20 object-cover rounded-lg border border-slate-200" alt="Preview" />
                          ) : (
                             <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 border border-slate-200">
                               <ImageIcon size={24} />
                             </div>
                          )}
                          <label className={`cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm transition-colors border border-slate-200 flex items-center gap-2 ${isProcessingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                             <Upload size={16} />
                             {isProcessingImage ? 'Сжатие...' : 'Загрузить'}
                             <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, setNewTplPhoto)} disabled={isProcessingImage} />
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block font-bold text-slate-700 mb-2">Сборка (мин)</label>
                          <input type="number" step="0.001" value={newTplAssembleTime} onChange={e => setNewTplAssembleTime(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg bg-white" />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-2">Упаковка (мин)</label>
                          <input type="number" step="0.001" value={newTplPackTime} onChange={e => setNewTplPackTime(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg bg-white" />
                        </div>
                      </div>
                   </div>

                   {/* Right Col: Plates Management */}
                   <div className="flex flex-col h-full">
                      <div className="flex justify-between items-center border-b pb-2 mb-4">
                        <h4 className="text-lg font-bold text-slate-800">Детали (Parts)</h4>
                        <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                          Всего: {Number(totalCalculatedPrintTime.toFixed(2))} мин
                        </span>
                      </div>

                      {/* Plate List */}
                      <div className="flex-1 bg-white rounded-xl border border-slate-200 p-3 mb-4 space-y-3 max-h-[220px] overflow-y-auto">
                        {groupedPlates.length === 0 && (
                          <div className="text-center text-slate-400 py-8">
                             Нет добавленных деталей
                          </div>
                        )}
                        {groupedPlates.map(group => {
                           const { plate, ids } = group;
                           const count = ids.length;
                           const isEditing = ids.includes(editingPlateId || '');

                           return (
                             <div key={group.signature} className={`bg-white p-3 rounded-lg border shadow-sm flex gap-3 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200' : 'border-slate-200'}`}>
                                <div className="w-12 h-12 bg-slate-100 rounded border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                                   {plate.photoUrl ? <img src={plate.photoUrl} className="w-full h-full object-cover" /> : <ImageIcon size={20} className="text-slate-300"/>}
                                   {count > 1 && (
                                      <div className="absolute bottom-0 right-0 bg-slate-800 text-white text-[10px] px-1 font-bold rounded-tl">
                                         x{count}
                                      </div>
                                   )}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start">
                                    <h5 className="font-bold text-slate-800 truncate">{plate.name}</h5>
                                    <div className="flex gap-1 items-center">
                                       <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg mr-2">
                                           <button 
                                              onClick={() => handleDecreasePlateCount(ids)}
                                              className="p-1 hover:bg-slate-200 text-slate-500 rounded-l-lg transition-colors"
                                           >
                                               <Minus size={12} />
                                           </button>
                                           <span className="text-xs font-bold w-4 text-center">{count}</span>
                                           <button 
                                              onClick={() => handleIncreasePlateCount(plate)}
                                              className="p-1 hover:bg-slate-200 text-slate-500 rounded-r-lg transition-colors"
                                           >
                                               <Plus size={12} />
                                           </button>
                                       </div>
                                       
                                       <button 
                                         type="button"
                                         onClick={() => handleEditPlate(plate)} 
                                         className="text-slate-400 hover:text-indigo-500 p-1"
                                         title="Редактировать"
                                       >
                                         <Pencil size={16} />
                                       </button>
                                       <button 
                                         type="button"
                                         onClick={() => handleDeletePlateGroup(ids)} 
                                         className="text-slate-400 hover:text-red-500 p-1"
                                         title="Удалить все"
                                       >
                                         <Trash2 size={16} />
                                       </button>
                                    </div>
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
                                     <span className="bg-slate-100 px-1.5 py-0.5 rounded border flex items-center gap-1">
                                       <Clock size={10} /> {Number(plate.printTimeMinutes.toFixed(2))}m
                                     </span>
                                     <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{plate.filamentType}</span>
                                     
                                     {plate.colors && plate.colors.map(c => {
                                       const hex = resolveColorHex(c, colors);
                                       const isLight = isLightColor(hex);
                                       return (
                                       <span 
                                         key={c} 
                                         className="px-1.5 py-0.5 rounded border flex items-center gap-1 font-bold shadow-sm"
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
                           )
                        })}
                      </div>

                      {/* Add Part Section */}
                      <div className={`bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm transition-all flex flex-col gap-3 ${showCreatePartForm ? 'ring-2 ring-indigo-200 bg-white' : ''}`}>
                         {showCreatePartForm ? (
                            // --- CREATE / EDIT FORM ---
                            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                              <h5 className="font-bold text-slate-800 mb-1 text-sm uppercase tracking-wide flex justify-between">
                                  {editingPlateId ? 'Редактировать деталь' : 'Новая деталь'}
                                  {editingPlateId && (
                                    <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Режим редактирования</span>
                                  )}
                              </h5>
                              <input 
                                  type="text" 
                                  placeholder="Название (напр. Крышка)" 
                                  className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 bg-white"
                                  value={plateName}
                                  onChange={e => setPlateName(e.target.value)}
                                  autoFocus
                              />
                              <div className="flex gap-2">
                                  <input 
                                    type="number" 
                                    placeholder="Мин" 
                                    className="w-1/3 p-2 border border-slate-300 rounded text-sm bg-white"
                                    value={plateTime}
                                    onChange={e => setPlateTime(e.target.value)}
                                    step="0.001"
                                  />
                                  <input 
                                    type="text" 
                                    placeholder="Филамент (PLA)" 
                                    className="flex-1 p-2 border border-slate-300 rounded text-sm bg-white"
                                    value={plateFilament}
                                    onChange={e => setPlateFilament(e.target.value)}
                                  />
                              </div>

                              {/* Plate Color Selection */}
                              <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1.5">Цвета детали (необязательно)</label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {colors.map(c => {
                                        const hex = c.hex;
                                        const isLight = isLightColor(hex);
                                        return (
                                        <button
                                            key={c.name}
                                            onClick={() => toggleColorSelection(c.name, plateColors, setPlateColors)}
                                            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-transform active:scale-95 shadow-sm
                                              ${plateColors.includes(c.name) ? 'ring-2 ring-slate-400 scale-105' : 'opacity-90'}
                                            `}
                                            style={{
                                              backgroundColor: hex,
                                              color: getTextColor(hex),
                                              borderColor: isLight ? '#cbd5e1' : hex
                                            }}
                                        >
                                            {plateColors.includes(c.name) && <Check size={12} />}
                                            {c.name}
                                        </button>
                                    )})}
                                </div>
                                
                                {/* Filament Usage Inputs */}
                                <div className="space-y-2 mt-2">
                                    {plateColors.length > 0 ? (
                                        plateColors.map((colorName, idx) => {
                                            const hex = resolveColorHex(colorName, colors);
                                            const isLight = isLightColor(hex);
                                            return (
                                              <div key={colorName} className="flex items-center gap-2">
                                                 <div 
                                                    className="w-4 h-4 rounded-full border shadow-sm flex-shrink-0"
                                                    style={{ backgroundColor: hex }}
                                                 />
                                                 <span className="text-xs font-bold text-slate-600 w-24 truncate">{colorName}</span>
                                                 <div className="flex items-center gap-1 flex-1">
                                                    <input 
                                                      type="number" 
                                                      placeholder="0"
                                                      value={plateFilamentUsages[idx] || ''}
                                                      onChange={(e) => updateFilamentUsage(idx, e.target.value)}
                                                      className="w-full p-1.5 border border-slate-200 rounded text-sm bg-white"
                                                    />
                                                    <span className="text-xs text-slate-400 font-bold">гр</span>
                                                 </div>
                                              </div>
                                            )
                                        })
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-600 w-24">Вес (общий)</span>
                                            <div className="flex items-center gap-1 flex-1">
                                                <input 
                                                  type="number" 
                                                  placeholder="0"
                                                  value={plateFilamentUsages[0] || ''}
                                                  onChange={(e) => updateFilamentUsage(0, e.target.value)}
                                                  className="w-full p-1.5 border border-slate-200 rounded text-sm bg-white"
                                                />
                                                <span className="text-xs text-slate-400 font-bold">гр</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                              </div>

                              {/* Plate Photo Upload */}
                              <div className="flex items-center gap-3 mt-2">
                                  <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center overflow-hidden">
                                    {platePhoto ? (
                                      <img src={platePhoto} className="w-full h-full object-cover" />
                                    ) : (
                                      <ImageIcon size={16} className="text-slate-300" />
                                    )}
                                  </div>
                                  <label className={`flex-1 cursor-pointer bg-slate-50 hover:bg-slate-100 text-slate-600 px-3 py-2 rounded border border-slate-200 text-xs font-bold transition-colors flex items-center justify-center gap-2 ${isProcessingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <Upload size={14} />
                                    {isProcessingImage ? 'Сжатие...' : (platePhoto ? 'Изменить фото' : 'Загрузить фото')}
                                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, setPlatePhoto)} disabled={isProcessingImage} />
                                  </label>
                              </div>
                              
                              <div className="flex gap-2 mt-2">
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setShowCreatePartForm(false);
                                      resetPlateForm();
                                    }}
                                    className="px-4 bg-slate-100 text-slate-600 font-bold py-2 rounded-lg text-sm hover:bg-slate-200 transition-colors"
                                  >
                                    Отмена
                                  </button>
                                  
                                  {editingPlateId && (
                                    <button
                                      onClick={handleSaveAsNewPart}
                                      disabled={!plateName || !plateTime}
                                      className="px-3 bg-emerald-50 text-emerald-700 font-bold py-2 rounded-lg text-sm hover:bg-emerald-100 border border-emerald-200 transition-colors flex items-center gap-1.5"
                                      title="Создать новую деталь на основе этой"
                                    >
                                      <Copy size={14} />
                                      Как новую
                                    </button>
                                  )}

                                  <button 
                                    onClick={handleCreateAndAddPart}
                                    disabled={!plateName || !plateTime}
                                    className="flex-1 bg-indigo-100 text-indigo-700 font-bold py-2 rounded-lg text-sm hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                                  >
                                    {editingPlateId ? 'Сохранить' : 'Создать'}
                                  </button>
                              </div>
                            </div>
                         ) : (
                            // --- SELECT FROM LIBRARY ---
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input 
                                            type="text" 
                                            placeholder="Поиск детали в библиотеке..." 
                                            className="w-full pl-8 pr-2 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500"
                                            value={partSearchTerm}
                                            onChange={e => setPartSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <button 
                                        onClick={() => {
                                           resetPlateForm();
                                           setShowCreatePartForm(true);
                                        }}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg shadow-sm transition-colors"
                                        title="Создать новую деталь"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>

                                {/* Library List */}
                                <div className="max-h-[120px] overflow-y-auto space-y-2 pr-1">
                                   {partSearchTerm && filteredGlobalParts.length === 0 && (
                                      <div className="text-center text-xs text-slate-400 py-2">Ничего не найдено</div>
                                   )}
                                   {(!partSearchTerm ? uniqueGlobalParts.slice(0, 10) : filteredGlobalParts).map(part => (
                                       <button 
                                          key={part.id}
                                          onClick={() => handleAddGlobalPartToTemplate(part)}
                                          className="w-full flex items-center gap-2 p-2 bg-white hover:bg-indigo-50 border border-slate-200 rounded-lg transition-colors group text-left"
                                       >
                                          <div className="w-8 h-8 bg-slate-100 rounded border border-slate-200 flex-shrink-0 overflow-hidden">
                                             {part.photoUrl ? <img src={part.photoUrl} className="w-full h-full object-cover" /> : <Library size={14} className="m-auto text-slate-300" />}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                              <div className="font-bold text-slate-700 text-xs truncate">{part.name}</div>
                                              <div className="text-[10px] text-slate-400 flex gap-2">
                                                  <span>{Number(part.printTimeMinutes.toFixed(2))}м</span>
                                                  <span>{part.filamentType}</span>
                                                  {part.filamentUsage && (
                                                    <span className="flex items-center gap-0.5"><Scale size={10}/> {part.filamentUsage.reduce((a,b)=>a+b, 0)}гр</span>
                                                  )}
                                              </div>
                                          </div>
                                          <Plus size={16} className="text-slate-300 group-hover:text-indigo-600" />
                                       </button>
                                   ))}
                                   {globalParts.length === 0 && (
                                       <div className="text-center text-xs text-slate-400 py-2">Библиотека деталей пуста</div>
                                   )}
                                </div>
                            </div>
                         )}
                      </div>
                   </div>
                 </div>
               </div>

               <div className="flex gap-4 mt-6 pt-4 border-t border-slate-100">
                 <button onClick={() => setShowTemplateForm(false)} className="flex-1 py-3 text-lg font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Отмена</button>
                 <button onClick={handleSaveTemplate} className="flex-1 py-3 text-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl">
                   {editingTemplateId ? 'Сохранить изменения' : 'Создать товар'}
                 </button>
               </div>
             </div>
          </div>
        )}
      </section>
    </div>
  );
};
