import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import * as controller from './sale.controller.js';

const router = Router();

// Almacén no consulta ventas; el controlador limita además a CASHIER a sus propias ventas.
const SALES_READ_ROLES = ['ADMIN', 'SUPERVISOR', 'FINANCE', 'CASHIER'];
const SALES_MANAGE_ROLES = ['ADMIN', 'SUPERVISOR', 'FINANCE'];

// Las rutas con dos segmentos van antes de /:id.
router.get('/', requireAuth, requireRole(...SALES_READ_ROLES), controller.listSales);
router.get('/:id/invoice.pdf', requireAuth, requireRole(...SALES_READ_ROLES), controller.downloadInvoice);
router.get('/:id', requireAuth, requireRole(...SALES_READ_ROLES), controller.getSale);

router.post('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'CASHIER'), controller.createSale);
router.post('/:id/void', requireAuth, requireRole(...SALES_MANAGE_ROLES), controller.voidSale);
router.post('/:id/resend-invoice', requireAuth, requireRole(...SALES_READ_ROLES), controller.resendInvoice);

export default router;
