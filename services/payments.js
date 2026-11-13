const crypto = require('crypto');
const { sequelize, Payment, Application, Cohort } = require('../models');
const paystack = require('./paystack');
const { enrollUser, notifyEnrollment } = require('./enrollment');
const { payableKobo } = require('../utils/cohort');

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Creates a pending payment and returns the Paystack checkout URL.
async function startPayment({ user, cohort, application = null }) {
  const amount = payableKobo(cohort);
  if (amount <= 0) throw new Error('Nothing to pay for this cohort');
  const reference = `TSA-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const payment = await Payment.create({
    userId: user.id,
    cohortId: cohort.id,
    applicationId: application ? application.id : null,
    reference,
    amountKobo: amount,
    purpose: application ? 'seat' : 'enrollment',
  });
  try {
    const data = await paystack.initialize({
      email: user.email,
      amount,
      currency: 'NGN',
      reference,
      callback_url: `${appUrl()}/payments/callback`,
      metadata: { paymentId: payment.id, cohortId: cohort.id, userId: user.id },
    });
    return data.authorization_url;
  } catch (err) {
    payment.status = 'failed';
    payment.note = String(err.message).slice(0, 250);
    await payment.save();
    throw err;
  }
}

// Idempotent: safe to call from both the browser callback and the webhook.
async function settlePayment(reference, gateway) {
  const outcome = await sequelize.transaction(async (t) => {
    const payment = await Payment.findOne({ where: { reference }, transaction: t, lock: t.LOCK.UPDATE });
    if (!payment) return null;
    if (payment.status === 'success') return { payment, fresh: false };

    if (gateway.status !== 'success') {
      payment.status = gateway.status === 'abandoned' ? 'abandoned' : 'failed';
      await payment.save({ transaction: t });
      return { payment, fresh: false };
    }
    if (gateway.amount !== payment.amountKobo || gateway.currency !== payment.currency) {
      payment.status = 'failed';
      payment.note = 'Amount or currency did not match';
      await payment.save({ transaction: t });
      return { payment, fresh: false };
    }

    payment.status = 'success';
    payment.paidAt = new Date();
    payment.channel = gateway.channel || null;
    payment.gatewayId = gateway.id ? String(gateway.id) : null;
    await payment.save({ transaction: t });

    const cohort = await Cohort.findByPk(payment.cohortId, { transaction: t });
    await enrollUser({
      cohortId: cohort.id,
      userId: payment.userId,
      source: payment.applicationId ? 'scholarship' : 'paid',
      applicationId: payment.applicationId,
      paymentId: payment.id,
      transaction: t,
    });
    if (payment.applicationId) {
      await Application.update({ status: 'accepted', acceptedAt: new Date() }, { where: { id: payment.applicationId }, transaction: t });
    }
    return { payment, fresh: true };
  });

  if (outcome && outcome.fresh) await notifyEnrollment(outcome.payment.userId, outcome.payment.cohortId, outcome.payment.amountKobo);
  return outcome ? outcome.payment : null;
}

// Asks Paystack for the truth, then settles.
async function verifyAndSettle(reference) {
  const gateway = await paystack.verify(reference);
  return settlePayment(reference, gateway);
}

module.exports = { startPayment, settlePayment, verifyAndSettle };
