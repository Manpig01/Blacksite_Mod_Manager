import React, { useState, useEffect } from 'react';
import { X, Tag, Plus, Check, Trash2, Palette } from 'lucide-react';
import { InstalledMod, ModTag } from '../types';

interface TagEditorModalProps {
  mod: InstalledMod | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveTags: (modId: string, tags: ModTag[]) => void;
  allExistingTags: ModTag[];
}

const COLOR_PALETTE = [
  { name: 'Emerald', value: '#10B981' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Crimson', value: '#EF4444' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Indigo', value: '#3B82F6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Orange', value: '#EA580C' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Slate', value: '#6B7280' },
];

const PRESET_SUGGESTIONS: { name: string; color: string }[] = [
  { name: 'Essential', color: '#10B981' },
  { name: 'Core AI', color: '#8B5CF6' },
  { name: 'Combat', color: '#EF4444' },
  { name: 'Server', color: '#F59E0B' },
  { name: 'Visuals', color: '#06B6D4' },
  { name: 'Overhaul', color: '#EC4899' },
  { name: 'QoL', color: '#3B82F6' },
  { name: 'Audio', color: '#84CC16' },
  { name: 'Weapons', color: '#EA580C' },
];

export const TagEditorModal: React.FC<TagEditorModalProps> = ({
  mod,
  isOpen,
  onClose,
  onSaveTags,
  allExistingTags,
}) => {
  const [currentTags, setCurrentTags] = useState<ModTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0].value);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (mod) {
      setCurrentTags(mod.tags ? [...mod.tags] : []);
      setNewTagName('');
      setErrorMessage('');
      setSelectedColor(COLOR_PALETTE[0].value);
    }
  }, [mod, isOpen]);

  if (!isOpen || !mod) return null;

  const handleAddTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a tag name.');
      return;
    }

    if (currentTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      setErrorMessage('This tag is already added to this mod.');
      return;
    }

    const newTag: ModTag = {
      id: `tag-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      color: selectedColor,
    };

    setCurrentTags((prev) => [...prev, newTag]);
    setNewTagName('');
    setErrorMessage('');
  };

  const handleRemoveTag = (tagId: string) => {
    setCurrentTags((prev) => prev.filter((t) => t.id !== tagId));
  };

  const handleAddExistingOrPreset = (name: string, color: string) => {
    if (currentTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return;
    }

    const existingMatch = allExistingTags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );

    const tagToAdd: ModTag = existingMatch
      ? { ...existingMatch }
      : {
          id: `tag-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name,
          color,
        };

    setCurrentTags((prev) => [...prev, tagToAdd]);
    setErrorMessage('');
  };

  const handleSaveAndClose = () => {
    onSaveTags(mod.id, currentTags);
    onClose();
  };

  // Combine unique existing tags across installed mods + default presets
  const combinedSuggestions = [...PRESET_SUGGESTIONS];
  allExistingTags.forEach((ext) => {
    if (!combinedSuggestions.some((s) => s.name.toLowerCase() === ext.name.toLowerCase())) {
      combinedSuggestions.push({ name: ext.name, color: ext.color });
    }
  });

  const availableSuggestions = combinedSuggestions.filter(
    (s) => !currentTags.some((t) => t.name.toLowerCase() === s.name.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] bg-[#14161A] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/40 flex items-center justify-center">
              <Tag className="w-4 h-4 text-[#EA580C]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#E8EAEE]">Edit Color-Coded Tags</h2>
              <p className="text-[11px] text-[#9AA3AF] truncate max-w-sm">
                Managing tags for <span className="text-[#EA580C] font-semibold">{mod.name}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded-lg transition-colors cursor-pointer"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Currently Applied Tags */}
          <div>
            <span className="font-bold text-[#E8EAEE] block mb-2 text-xs">
              Assigned Tags ({currentTags.length}):
            </span>

            {currentTags.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#121418] border border-[#23272E] text-center text-[#9AA3AF] italic text-[11.5px]">
                No custom tags assigned to this mod yet. Create one below or pick a preset.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 bg-[#121418] border border-[#23272E] rounded-lg">
                {currentTags.map((tag) => (
                  <span
                    key={tag.id}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      borderColor: `${tag.color}60`,
                      color: tag.color,
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border shadow-2xs group transition-all"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span>{tag.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag.id)}
                      className="p-0.5 rounded-full hover:bg-black/30 hover:opacity-100 opacity-60 transition-opacity cursor-pointer ml-0.5"
                      title="Remove tag"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Create Custom Tag */}
          <div className="bg-[#121418] border border-[#23272E] rounded-lg p-3.5 space-y-3">
            <span className="font-bold text-[#E8EAEE] block text-xs">
              Create New Custom Tag:
            </span>

            {/* Name Input & Live Preview */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-[#9AA3AF] block">Tag Name:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => {
                    setNewTagName(e.target.value);
                    setErrorMessage('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="e.g. Essential, Performance, Hardcore..."
                  className="flex-1 bg-[#0E1013] border border-[#2A2F38] rounded-md px-3 py-1.5 text-xs text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C]"
                />

                <button
                  type="button"
                  onClick={handleAddTag}
                  className="bg-[#EA580C] hover:bg-[#F97316] text-white px-3.5 py-1.5 rounded-md font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Tag</span>
                </button>
              </div>
              {errorMessage && (
                <p className="text-[11px] text-[#EF4444] font-medium">{errorMessage}</p>
              )}
            </div>

            {/* Color Swatches */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-[#9AA3AF]">Select Color Theme:</label>
                {newTagName.trim() && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-[#6B7480]">Preview:</span>
                    <span
                      style={{
                        backgroundColor: `${selectedColor}22`,
                        borderColor: `${selectedColor}66`,
                        color: selectedColor,
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border text-[11px]"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: selectedColor }}
                      />
                      <span>{newTagName.trim()}</span>
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PALETTE.map((c) => {
                  const isSelected = selectedColor === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setSelectedColor(c.value)}
                      style={{ backgroundColor: c.value }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform cursor-pointer relative shadow-sm ${
                        isSelected
                          ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#181B20]'
                          : 'hover:scale-105 opacity-80 hover:opacity-100'
                      }`}
                      title={c.name}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Quick-Add Suggestions / Existing Tags Pool */}
          {availableSuggestions.length > 0 && (
            <div>
              <span className="text-[11px] text-[#9AA3AF] font-bold block mb-1.5">
                Suggested & Common Tags (Click to add):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {availableSuggestions.map((sug) => (
                  <button
                    key={sug.name}
                    type="button"
                    onClick={() => handleAddExistingOrPreset(sug.name, sug.color)}
                    style={{
                      backgroundColor: `${sug.color}15`,
                      borderColor: `${sug.color}40`,
                      color: sug.color,
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.8 rounded-full border text-[11px] font-medium hover:brightness-125 transition-all cursor-pointer"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: sug.color }}
                    />
                    <span>+ {sug.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161A] flex items-center justify-between">
          <span className="text-[11px] text-[#6B7480]">
            Tags are saved automatically to your local SPT profile.
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] px-3 py-1.5 rounded-md font-semibold text-xs cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white px-4 py-1.5 rounded-md font-semibold text-xs cursor-pointer transition-colors shadow-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
