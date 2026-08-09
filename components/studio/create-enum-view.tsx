"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2, List } from "@/lib/icon-theme/lucide-react";

interface CreateEnumViewProps {
  selectedSchema: string;
  onCreateEnum: (name: string, schema: string, values: string[]) => Promise<void>;
  onUpdateEnum?: (name: string, schema: string, values: string[]) => Promise<void>;
  isCreating: boolean;
  isEditing?: boolean;
  newEnumData: { name: string; values: string[] };
  setNewEnumData: React.Dispatch<React.SetStateAction<{ name: string; values: string[] }>>;
}

export function CreateEnumView({ 
  selectedSchema, 
  onCreateEnum, 
  onUpdateEnum,
  isCreating,
  isEditing = false,
  newEnumData,
  setNewEnumData
}: CreateEnumViewProps) {
  const newEnumName = newEnumData.name;
  const newEnumValues = newEnumData.values;

  const setNewEnumName = (name: string) => {
    setNewEnumData(prev => ({ ...prev, name }));
  };

  const setNewEnumValues = (values: string[] | ((prev: string[]) => string[])) => {
    setNewEnumData(prev => ({ 
      ...prev, 
      values: typeof values === 'function' ? values(prev.values) : values 
    }));
  };

  const addValue = () => {
    setNewEnumValues([...newEnumValues, '']);
  };

  const removeValue = (index: number) => {
    if (newEnumValues.length <= 1) return;
    setNewEnumValues(newEnumValues.filter((_, i) => i !== index));
  };

  const updateValue = (index: number, value: string) => {
    const updated = [...newEnumValues];
    updated[index] = value;
    setNewEnumValues(updated);
  };

  const handleSubmit = () => {
    const validValues = newEnumValues.filter(v => v.trim() !== '');
    if (validValues.length === 0) return;
    
    if (isEditing && onUpdateEnum) {
      onUpdateEnum(newEnumName, selectedSchema, validValues);
    } else {
      onCreateEnum(newEnumName, selectedSchema, validValues);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-6 border-b border-border bg-muted/30">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {isEditing ? `Edit enum type: ${newEnumName}` : "Create a new enum type"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isEditing 
                ? `Modify the values or rename the enum in `
                : `Define a set of static values for your enum in `
              }
              <span className="text-foreground font-mono font-bold bg-muted px-1 rounded">{selectedSchema}</span>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!newEnumName.trim() || newEnumValues.filter(v => v.trim() !== '').length === 0 || isCreating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-6 text-xs font-bold"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : (
                isEditing ? "Update Enum" : "Create Enum"
              )}
            </Button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="space-y-3">
            <Label htmlFor="enumName" className="text-xs tracking-wider text-muted-foreground">Type Name</Label>
            <Input
              id="enumName"
              value={newEnumName}
              onChange={(e) => setNewEnumName(e.target.value)}
              placeholder="e.g. user_role"
              className="bg-secondary/30 border-border text-foreground focus-visible:ring-blue-500/50 h-10"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <Label className="text-xs tracking-wider text-muted-foreground flex items-center gap-2">
                <List className="w-3.5 h-3.5" />
                Values
              </Label>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={addValue}
                className="h-7 text-xs gap-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-500/5"
              >
                <Plus className="w-3 h-3" />
                Add value
              </Button>
            </div>

            <div className="space-y-3">
              {newEnumValues.map((val, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input 
                      value={val}
                      onChange={(e) => updateValue(idx, e.target.value)}
                      className="h-9 text-xs bg-background border-border focus-visible:ring-blue-500/50 w-full"
                      placeholder={`Value ${idx + 1}`}
                    />
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeValue(idx)}
                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                    disabled={newEnumValues.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
