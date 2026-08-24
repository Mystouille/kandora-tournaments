import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./mobile.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Kandora mobile root element is missing");
}

createRoot(root).render(<App />);