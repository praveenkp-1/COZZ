import { createApp, errorHandler } from "./src/app.js";

const app = createApp();

app.use(errorHandler);

export default app;