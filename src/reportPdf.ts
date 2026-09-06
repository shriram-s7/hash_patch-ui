/**
 * PDF export utility for the Report view.
 *
 * Renders each of the 8 "page" <div>s (pdf-page-1 through pdf-page-8)
 * individually via html2canvas → jsPDF, placing each on its own PDF page.
 * This guarantees clean page breaks with no chart/table splitting, and
 * enables per-page footers.
 *
 * Both libraries are dynamically imported so they're code-split and only
 * loaded when the user clicks "Export PDF".
 */

const PAGE_COUNT = 8;
const PDF_WIDTH_MM = 210; // A4
const PDF_HEIGHT_MM = 297;
const MARGIN_MM = 12;
const FOOTER_HEIGHT_MM = 8;
const CONTENT_WIDTH_MM = PDF_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT_MM = PDF_HEIGHT_MM - MARGIN_MM * 2 - FOOTER_HEIGHT_MM;

export async function exportReportPdf(
  _elementId: string,
  filename: string,
  targetPath: string,
): Promise<void> {
  const [html2canvasModule, jsPdfModule] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const html2canvas = (html2canvasModule as any).default || html2canvasModule;
  const jsPDFClass =
    (jsPdfModule as any).jsPDF ||
    (jsPdfModule as any).default?.jsPDF ||
    (jsPdfModule as any).default;

  const pdf = new jsPDFClass({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const now = new Date().toLocaleString();

  // The parent wrapper #pdf-pages-container hides all pages.
  // Place it in positive coordinate space at top:0 left:0 but invisible to interaction
  // so html2canvas computes valid bounding boxes without negative offset clipping.
  const container = document.getElementById("pdf-pages-container");
  if (container) {
    container.style.display = "block";
    container.style.position = "fixed";
    container.style.top = "0px";
    container.style.left = "0px";
    container.style.width = "850px";
    container.style.opacity = "0.01";
    container.style.pointerEvents = "none";
    container.style.zIndex = "-9999";
    container.style.overflow = "visible";
  }

  // Allow layout and charts to settle
  await new Promise((r) => setTimeout(r, 200));

  let pagesRendered = 0;

  for (let pageNum = 1; pageNum <= PAGE_COUNT; pageNum++) {
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    if (!pageEl) continue;

    // Ensure visible and correct width
    pageEl.style.display = "block";
    pageEl.style.width = "800px";

    try {
      const canvas = await html2canvas(pageEl, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        width: 800,
        windowWidth: 1200,
      });

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      // Guard against empty canvases
      if (imgWidth === 0 || imgHeight === 0) continue;

      if (pagesRendered > 0) pdf.addPage();
      pagesRendered++;

      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      // Scale to fit content area
      const scaledHeight = (imgHeight / imgWidth) * CONTENT_WIDTH_MM;
      const finalHeight = Math.min(scaledHeight, CONTENT_HEIGHT_MM);
      const finalWidth =
        scaledHeight <= CONTENT_HEIGHT_MM
          ? CONTENT_WIDTH_MM
          : (imgWidth / imgHeight) * CONTENT_HEIGHT_MM;
      const xOffset = MARGIN_MM + (CONTENT_WIDTH_MM - finalWidth) / 2;

      pdf.addImage(imgData, "JPEG", xOffset, MARGIN_MM, finalWidth, finalHeight);

      // Footer
      pdf.setFontSize(7);
      pdf.setTextColor(140, 140, 140);
      const footerY = PDF_HEIGHT_MM - MARGIN_MM;
      const truncatedPath = targetPath.length > 60 ? "…" + targetPath.slice(-59) : targetPath;
      pdf.text(truncatedPath, MARGIN_MM, footerY);
      pdf.text(`Page ${pageNum} of ${PAGE_COUNT}`, PDF_WIDTH_MM / 2, footerY, { align: "center" });
      pdf.text(now, PDF_WIDTH_MM - MARGIN_MM, footerY, { align: "right" });
    } catch (err) {
      console.warn(`Failed to render PDF page ${pageNum}:`, err);
    }
  }

  // Restore container
  if (container) {
    container.style.display = "none";
    container.style.position = "";
    container.style.top = "";
    container.style.left = "";
    container.style.width = "";
    container.style.opacity = "";
    container.style.pointerEvents = "";
    container.style.zIndex = "";
    container.style.overflow = "";
  }

  if (pagesRendered > 0) {
    pdf.save(filename);
  } else {
    // Fallback: trigger browser print
    window.print();
  }
}
