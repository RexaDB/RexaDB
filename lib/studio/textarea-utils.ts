export function handleTextareaTabKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
) {
  if (e.key === "Tab") {
    e.preventDefault();
    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const newValue = value.substring(0, start) + "\t" + value.substring(end);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    nativeInputValueSetter?.call(target, newValue);
    target.selectionStart = target.selectionEnd = start + 1;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
