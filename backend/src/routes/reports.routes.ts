import { Router } from "express";
import { reportCreator, reportMapFetch, reportStatus } from "../controllers/reports.controllers";

const router = Router();

router.post("/", reportCreator );

router.get("/status/:id", reportStatus );

router.get("/map", reportMapFetch );

export default router;