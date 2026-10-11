import express from "express";
import { createApp, errorHandler } from "./src/app.js";

const app: ReturnType<typeof express> = createApp();

app.use(errorHandler);

export default app;