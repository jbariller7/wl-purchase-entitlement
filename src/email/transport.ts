import nodemailer from 'nodemailer';
// Shared authenticated Workspace transport; no Stripe or purchase initialization
// is needed to accept or forward a support message.
export function confirmationTransport(){
 const pass=process.env.ORDER_EMAIL_SMTP_PASSWORD;
 if(!pass)throw new Error('Order email SMTP password is not configured.');
 return nodemailer.createTransport({host:'smtp-relay.gmail.com',port:587,secure:false,requireTLS:true,
  auth:{user:'jonathan@wonderlang.app',pass},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
  connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,logger:false,debug:false,
  disableFileAccess:true,disableUrlAccess:true});
}
