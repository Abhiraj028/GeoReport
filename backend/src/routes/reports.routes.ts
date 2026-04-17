import { Router } from "express";
import { requireDevice, trackDevice } from "../middlewares/device.middleware.ts";
import { catchAsync } from "../utils/catch.async.ts";
import {
  reportCreator,
  reportMediaUrlCreator,
  reportMediaConfirm,
  reportsFetch,
  reportsDetailFetch,
} from "../controllers/reports.controllers.ts";

const router = Router();

router.post("/", requireDevice, catchAsync(reportCreator));
router.post("/media/uploadUrl", requireDevice, catchAsync(reportMediaUrlCreator));
router.post("/media/confirmUpload", requireDevice, catchAsync(reportMediaConfirm));
router.get("/", catchAsync(reportsFetch));
router.get("/:id", trackDevice, catchAsync(reportsDetailFetch));

export default router;
