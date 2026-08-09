function preventSelectStart(e: Event) {
  e.preventDefault()
}

export function preventTextSelection() {
  document.body.style.userSelect = "none"
  document.addEventListener("selectstart", preventSelectStart)
}

export function allowTextSelection() {
  document.body.style.userSelect = ""
  document.removeEventListener("selectstart", preventSelectStart)
}
