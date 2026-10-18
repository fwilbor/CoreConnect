/*
 * CoreConnect embeddable inquiry form (FR-02).
 * Paste where the form should appear on Wix, Squarespace, WordPress or Shopify:
 *   <script src="https://YOUR-APP/embed.js" data-form="your-slug" async></script>
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-form");
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return;
  var origin = new URL(script.src).origin;

  var frame = document.createElement("iframe");
  frame.src = origin + "/" + slug + "/inquire?embed=1";
  frame.title = "Inquiry form";
  frame.loading = "lazy";
  frame.style.cssText = "width:100%;max-width:640px;border:0;min-height:640px;display:block;";
  script.parentNode.insertBefore(frame, script);

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && data.type === "coreconnect:height" && typeof data.height === "number") {
      frame.style.height = Math.max(200, Math.min(data.height, 5000)) + "px";
    }
  });
})();
