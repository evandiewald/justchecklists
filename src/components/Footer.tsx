import { useEffect } from "react";

export const Footer = () => {
  useEffect(() => {
    const container = document.getElementById("bmc-button-container");
    if (!container || container.childNodes.length > 0) return;

    const script = document.createElement("script");
    script.src = "https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js";
    script.async = true;

    script.setAttribute("data-emoji", "");
    script.setAttribute("data-name", "bmc-button");
    script.setAttribute("data-slug", "evandiewald");
    script.setAttribute("data-color", "#FFDD00");
    script.setAttribute("data-font", "Cookie");
    script.setAttribute("data-text", "Buy me a coffee");
    script.setAttribute("data-outline-color", "#000000");
    script.setAttribute("data-font-color", "#000000");
    script.setAttribute("data-coffee-color", "#ffffff");

    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <footer className="app-footer">
      <div className="footer-content">
        <p className="copyright">
          © {new Date().getFullYear()} Evan Diewald
        </p>

        <div id="bmc-button-container" />

        <div className="footer-links">
          <a 
            href="https://www.buymeacoffee.com/evandiewald" 
            target="_blank"
            className="footer-icon-link"
            rel="noopener noreferrer"
            title="Buy me a Coffee"
        >
            <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="26"></img>
          </a>
          <a
            href="https://github.com/evandiewald/justchecklists/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-icon-link"
            title="Report a Bug"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.195 5.635A6.5 6.5 0 0 0 5.5 11.5v5a6.5 6.5 0 1 0 13 0v-5a6.5 6.5 0 0 0-9.305-5.865"/>
              <path d="M3 10h2.5m13 0H21M3 18h2.5m13 0H21M9 5.4L7 3m8 2.4L17 3M5.5 16.5v-5a6.5 6.5 0 0 1 13 0v5a6.5 6.5 0 1 1-13 0ZM10 11h4m-4 6h4"/>
            </svg>
          </a>
          <a
            href="https://github.com/evandiewald/justchecklists"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-icon-link"
            title="View on GitHub"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
};
