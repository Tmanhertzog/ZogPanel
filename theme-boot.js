// Applies the saved theme before first paint so the page doesn't flash.
(function () {
  try {
    var theme = localStorage.getItem("zog.theme") || "basic";
    if (["basic", "motivated", "chill"].indexOf(theme) < 0) theme = "basic";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "basic");
  }
})();
