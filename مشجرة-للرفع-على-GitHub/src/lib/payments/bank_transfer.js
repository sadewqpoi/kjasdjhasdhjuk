'use strict';
/**
 * التحويل البنكي — مجاني وبدون بوابة إلكترونية.
 * العضو يحوّل المبلغ إلى حساب الصندوق ويرسل بيانات التحويل (وصورة الإيصال اختياريًا)،
 * ثم يراجعها المسؤول من لوحة الإدارة ويعتمدها، فيُفعَّل الاشتراك.
 */
module.exports = {
  key: 'bank_transfer',
  label: 'تحويل بنكي (يدوي)',
  desc: 'العضو يحوّل إلى حساب الصندوق ويرفع الإيصال، والإدارة تعتمد التحويل. بدون رسوم بوابة.',
  defaultDescription: 'حوّل إلى حساب الصندوق وارفع الإيصال',
  manual: true,
  fields: [
    { key: 'bank_name', label: 'اسم البنك', required: true, placeholder: 'مثال: مصرف الراجحي' },
    { key: 'account_name', label: 'اسم صاحب الحساب', required: true, placeholder: 'مثال: صندوق سليمان عبدالله التويجري' },
    { key: 'iban', label: 'رقم الآيبان (IBAN)', required: true, placeholder: 'SA00 0000 0000 0000 0000 0000' },
    { key: 'account_no', label: 'رقم الحساب (اختياري)' },
    { key: 'instructions', label: 'تعليمات إضافية (اختياري)', type: 'textarea' },
  ],
  /** ما يُعرض للعضو (بيانات الحساب ليست سرية) */
  publicInfo(cfg) {
    return { bank_name: cfg.bank_name || '', account_name: cfg.account_name || '', iban: cfg.iban || '', account_no: cfg.account_no || '', instructions: cfg.instructions || '' };
  },
};
