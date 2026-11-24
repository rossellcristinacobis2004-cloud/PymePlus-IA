import { Router } from 'express';
import {
  requireAuth,
  requireRole,
  requireAdmin,
  requirePricePermission
} from '../../middlewares/auth.middleware.js';
import * as controller from './product.controller.js';

const router = Router();

// Las rutas específicas van antes de /:id para que Express 5 no las capture como id.
router.get('/', requireAuth, controller.list);
router.get('/low-stock', requireAuth, controller.lowStock);
router.get('/expiring', requireAuth, controller.expiring);
router.get('/barcode/:barcode', requireAuth, controller.getByBarcode);
router.get('/sku/:sku', requireAuth, controller.getBySku);
router.get('/:id', requireAuth, controller.getById);

router.post('/', requireAuth, requireAdmin, controller.create);
router.patch('/:id', requireAuth, requirePricePermission, controller.update);
router.delete('/:id', requireAuth, requireRole('ADMIN'), controller.remove);
router.post('/:id/stock-adjustments', requireAuth, requireRole('ADMIN', 'WAREHOUSE'), controller.adjustStock);

export default router;
