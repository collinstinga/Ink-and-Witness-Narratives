import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  FolderPlus, 
  Edit2, 
  Check, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  AlertTriangle,
  Folder,
  Layers,
  Sparkles,
  Loader2
} from 'lucide-react';
import { Category, Article } from '../../types.js';
import { api, getWriterToken } from '../../utils/api.js';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  articles?: Article[];
  onCategoriesUpdated: (updated: Category[]) => void;
  onRequestWriterLogin?: () => void;
}

export const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({
  isOpen,
  onClose,
  categories,
  articles = [],
  onCategoriesUpdated,
  onRequestWriterLogin
}) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check auth
  const isWriterLoggedIn = Boolean(getWriterToken());

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMessage(null);
      setNewCategoryName('');
      setEditingId(null);
      setDeleteConfirmId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Count pieces per category
  const getPieceCount = (catName: string) => {
    return articles.filter(art => 
      art.category === catName || (art.categories && art.categories.includes(catName))
    ).length;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    if (!isWriterLoggedIn) {
      if (onRequestWriterLogin) {
        onRequestWriterLogin();
      } else {
        setError("Writer authentication required to manage categories.");
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const created = await api.createCategory(newCategoryName.trim(), newCategoryDescription.trim());
      const updated = [...categories, created].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onCategoriesUpdated(updated);
      setNewCategoryName('');
      setNewCategoryDescription('');
      setSuccessMessage(`Category "${created.name}" created successfully.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to create category.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
    setEditingDescription(cat.description || '');
    setDeleteConfirmId(null);
    setError(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      setLoading(true);
      setError(null);
      const updatedCat = await api.updateCategory(id, editingName.trim(), editingDescription.trim());
      const updatedList = categories.map(c => c.id === id ? updatedCat : c);
      onCategoriesUpdated(updatedList);
      setEditingId(null);
      setSuccessMessage(`Category renamed to "${updatedCat.name}". Pieces updated automatically.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update category.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      await api.deleteCategory(id);
      const updatedList = categories.filter(c => c.id !== id);
      onCategoriesUpdated(updatedList);
      setDeleteConfirmId(null);
      setSuccessMessage('Category deleted safely. Associated pieces have been preserved.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete category.');
    } finally {
      setLoading(false);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const reordered = [...categories];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;

    const ids = reordered.map(c => c.id);
    
    // Optimistic update
    onCategoriesUpdated(reordered);

    try {
      const serverReordered = await api.reorderCategories(ids);
      onCategoriesUpdated(serverReordered);
    } catch (err: any) {
      console.error("Failed to persist category order:", err);
      // Revert if error
      onCategoriesUpdated(categories);
      setError(err.message || 'Failed to reorder categories.');
    }
  };

  return (
    <div 
      id="category-manager-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        id="category-manager-modal"
        className="relative w-full max-w-xl bg-gradient-to-b from-[#0f172a] to-[#0b111e] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-serif font-bold text-white tracking-wide">
                Manage Categories
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Create, edit, reorder, or delete custom search categories
              </p>
            </div>
          </div>

          <button
            id="close-category-manager-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800/80 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-950/80 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-200 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* Create New Category Form */}
          <form onSubmit={handleCreate} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="new-category-input" className="text-xs font-mono font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <FolderPlus className="w-4 h-4" />
                <span>Add Custom Category</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                e.g., Love, Erotica, Intimacy, Relationships
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="new-category-input"
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Enter category name..."
                disabled={loading}
                className="flex-1 px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-sans"
              />
              <button
                id="create-category-btn"
                type="submit"
                disabled={loading || !newCategoryName.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-sky-950/40 shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>+ Add Category</span>
              </button>
            </div>
          </form>

          {/* Existing Categories List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Active Categories ({categories.length})
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {categories.length === 0 ? 'No custom categories created yet' : 'Custom categories created by author'}
              </span>
            </div>

            {categories.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-900/40 border border-dashed border-slate-800 space-y-2">
                <Folder className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm text-slate-300 font-medium">No custom categories yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Only categories you create will appear beneath the search bar. Start by adding your first category above.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((cat, index) => {
                  const pieceCount = getPieceCount(cat.name);
                  const isEditing = editingId === cat.id;
                  const isConfirmingDelete = deleteConfirmId === cat.id;

                  return (
                    <div 
                      key={cat.id}
                      id={`category-row-${cat.id}`}
                      className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col gap-2"
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input 
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            disabled={loading}
                            className="flex-1 px-3 py-1.5 rounded-md bg-slate-950 border border-sky-500/60 text-white text-sm focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(cat.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button
                            id={`save-category-edit-${cat.id}`}
                            onClick={() => handleSaveEdit(cat.id)}
                            disabled={loading || !editingName.trim()}
                            className="p-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                            title="Save Rename"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={loading}
                            className="p-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-5 text-center text-xs font-mono text-slate-400">
                              {index + 1}
                            </span>
                            <span className="font-medium text-slate-200 text-sm truncate">
                              {cat.name}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/80 text-slate-400 border border-slate-700/60 shrink-0">
                              {pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Move Up */}
                            <button
                              id={`move-up-category-${cat.id}`}
                              onClick={() => handleMove(index, 'up')}
                              disabled={index === 0 || loading}
                              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>

                            {/* Move Down */}
                            <button
                              id={`move-down-category-${cat.id}`}
                              onClick={() => handleMove(index, 'down')}
                              disabled={index === categories.length - 1 || loading}
                              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>

                            {/* Edit / Rename */}
                            <button
                              id={`edit-category-${cat.id}`}
                              onClick={() => handleStartEdit(cat)}
                              disabled={loading}
                              className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                              title="Rename Category"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              id={`delete-category-${cat.id}`}
                              onClick={() => setDeleteConfirmId(cat.id)}
                              disabled={loading}
                              className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                              title="Delete Category"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delete Confirmation Box */}
                      {isConfirmingDelete && (
                        <div className="mt-2 p-3 rounded-lg bg-red-950/90 border border-red-800/80 text-xs text-red-200 space-y-2 animate-fadeIn">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-white">Delete "{cat.name}" category?</p>
                              <p className="text-slate-300 text-[11px] mt-0.5">
                                This will remove the category from search and piece filters. <strong>No published writing or pieces will be deleted.</strong>
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              disabled={loading}
                              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              id={`confirm-delete-category-${cat.id}`}
                              onClick={() => handleDelete(cat.id)}
                              disabled={loading}
                              className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors"
                            >
                              {loading ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Safety & Persistence Notice */}
          <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800/60 text-slate-400 text-[11px] font-mono leading-relaxed">
            <span className="text-sky-400 font-bold">Persistence Note:</span> Categories are saved permanently to the database. Deleting a category updates piece filters safely and never deletes your writing.
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end">
          <button
            id="done-category-manager-btn"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
