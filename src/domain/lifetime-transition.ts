export interface LifetimeCheckoutIntent {
  uid: string;
  confirmedCancelExistingSubscription: boolean;
  activeStripeSubscriptionId?: string;
  activeStoreSubscription?: "google_play" | "apple";
}

export interface LifetimeTransition {
  allowCheckout: boolean;
  cancelStripeSubscriptionAfterPayment?: string;
  externalCancellationRequired?: "google_play" | "apple";
  warning?: string;
}

export function planLifetimeTransition(intent: LifetimeCheckoutIntent): LifetimeTransition {
  const hasSubscription = Boolean(intent.activeStripeSubscriptionId || intent.activeStoreSubscription);
  if (hasSubscription && !intent.confirmedCancelExistingSubscription) {
    return {
      allowCheckout: false,
      warning: "Confirm that the existing subscription should be canceled after the lifetime payment succeeds."
    };
  }
  if (intent.activeStoreSubscription) {
    return {
      allowCheckout: true,
      externalCancellationRequired: intent.activeStoreSubscription,
      warning: "The app-store subscription must be canceled in that store; the website cannot guarantee immediate cancellation."
    };
  }
  return {
    allowCheckout: true,
    ...(intent.activeStripeSubscriptionId ? { cancelStripeSubscriptionAfterPayment: intent.activeStripeSubscriptionId } : {})
  };
}
