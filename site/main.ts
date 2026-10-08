import { mount } from "svelte";
import App from "./App.svelte";
import "./tailwind.css";

mount(App, { target: document.getElementById("app")! });
