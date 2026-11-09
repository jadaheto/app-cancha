import { Reservation } from '../domain/reservation';

/** Serializa una reserva de dominio a la forma pública de la API. */
export function reservationToView(r: Reservation) {
  return {
    id: r.id,
    courtId: r.courtId,
    courtName: r.courtName,
    userId: r.userId,
    userName: r.userName,
    userPhone: r.userPhone,
    userEmail: r.userEmail,
    userDocument: r.userDocument,
    userCategory: r.userCategory,
    categoryPrice: r.categoryPrice,
    startTime: r.startTime,
    endTime: r.endTime,
    durationHours: r.durationHours(),
    status: r.status,
    paymentStatus: r.paymentStatus,
    paymentMethod: r.paymentMethod,
    paymentReference: r.paymentReference,
    totalAmount: r.totalAmount,
    notes: r.notes,
    verifiedAt: r.verifiedAt,
    paidAt: r.paidAt,
    paymentExpiresAt: r.paymentExpiresAt,
    expiredAt: r.expiredAt,
    createdAt: r.createdAt,
  };
}
