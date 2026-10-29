// Aplica el tema guardado (claro u oscuro) antes de que la página se dibuje, para que no parpadee. Sin tema guardado,
// la página sigue al sistema operativo. Es un script clásico en <head>; el selector de tema lo arma app.js.
(function () {
  try {
    var tema = window.localStorage.getItem("tema");
    if (tema === "claro" || tema === "oscuro") document.documentElement.setAttribute("data-tema", tema);
  } catch (error) {
    // sin almacenamiento (navegación privada o datos del sitio bloqueados): sigue al sistema
  }
})();
