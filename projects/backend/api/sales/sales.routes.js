import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import * as controller from './sale.controller.js';

const router = Router();

// Las rutas con dos segmentos van antes de /:id.
router.get('/', requireAuth, controller.listSales);
router.get('/:id/invoice.pdf', requireAuth, controller.downloadInvoice);
router.get('/:id', requireAuth, controller.getSale);

router.post('/', requireAuth, controller.createSale);
router.post('/:id/void', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), controller.voidSale);
router.post('/:id/resend-invoice', requireAuth, controller.resendInvoice);

export default router;
