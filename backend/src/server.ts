import { app } from "./app.ts";

const PORT = process.env.PORT ?? "3000";

app.listen(Number(PORT), () => {
  console.log(`[server] SlideTag backend running on port ${PORT}`);
});
