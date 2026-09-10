export function handleExportCBOM(cbomData: unknown) {
  if (!cbomData) {
    alert("No CBOM data available. Run a scan first.");
    return;
  }

  const json = typeof cbomData === "string" ? cbomData : JSON.stringify(cbomData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hashpatch-cbom-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
