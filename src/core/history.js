// تراجع بلا حد: لقطات JSON للمشروع
export class History {
  constructor(limit = Infinity) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
    this.current = null;
  }
  reset(state) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = JSON.stringify(state);
  }
  /** يسجل الحالة الجديدة إن تغيرت. يعيد true إن سُجّلت */
  push(state) {
    const s = JSON.stringify(state);
    if (s === this.current) return false;
    if (this.current !== null) this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.current = s;
    this.redoStack = [];
    return true;
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() {
    if (!this.canUndo()) return null;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    return JSON.parse(this.current);
  }
  redo() {
    if (!this.canRedo()) return null;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    return JSON.parse(this.current);
  }
}
