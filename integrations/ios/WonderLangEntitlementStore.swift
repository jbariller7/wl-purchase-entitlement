import FirebaseAuth
import Foundation
import StoreKit

/// Clean-room StoreKit 2/account adapter. Add to the duplicate iOS project when its source is available.
@MainActor
final class WonderLangEntitlementStore: ObservableObject {
    static let monthlyProductID = "wonderlangmonthly"
    static let lifetimeProductID = "wonderlangfull"

    @Published private(set) var entitlementJSON = "{}"
    @Published private(set) var lastError: String?

    private let apiBase = URL(string: "https://wl-purchase-entitlement.netlify.app")!
    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = Task {
            for await result in Transaction.updates {
                do {
                    let transaction = try Self.verified(result)
                    try await claim(result.jwsRepresentation)
                    await transaction.finish()
                } catch {
                    lastError = error.localizedDescription
                }
            }
        }
    }

    deinit { updatesTask?.cancel() }

    func refreshEntitlements() async throws {
        let data = try await api(path: "/api/v1/me", method: "GET")
        entitlementJSON = String(decoding: data, as: UTF8.self)
    }

    func purchase(productID: String) async throws {
        guard productID == Self.monthlyProductID || productID == Self.lifetimeProductID else {
            throw AccountError.unknownProduct
        }
        guard let product = try await Product.products(for: [productID]).first else {
            throw AccountError.productUnavailable
        }
        let accountToken = try await storeAccountToken()
        let result = try await product.purchase(options: [.appAccountToken(accountToken)])
        switch result {
        case .success(let verification):
            let transaction = try Self.verified(verification)
            try await claim(verification.jwsRepresentation)
            await transaction.finish()
        case .pending:
            throw AccountError.pending
        case .userCancelled:
            return
        @unknown default:
            throw AccountError.unknownResult
        }
    }

    func restore() async throws {
        try await AppStore.sync()
        for await result in Transaction.currentEntitlements {
            let transaction = try Self.verified(result)
            try await claim(result.jwsRepresentation)
            if !transaction.isUpgraded { await transaction.finish() }
        }
        try await refreshEntitlements()
    }

    private func claim(_ signedTransaction: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["signedTransactionInfo": signedTransaction])
        let data = try await api(path: "/api/v1/apple/claim", method: "POST", body: body)
        entitlementJSON = String(decoding: data, as: UTF8.self)
    }

    private func storeAccountToken() async throws -> UUID {
        let data = try await api(path: "/api/v1/store-account-token", method: "GET")
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let text = object?["storeAccountToken"] as? String, let token = UUID(uuidString: text) else {
            throw AccountError.invalidServerResponse
        }
        return token
    }

    private func api(path: String, method: String, body: Data? = nil) async throws -> Data {
        guard let user = Auth.auth().currentUser else { throw AccountError.signInRequired }
        let idToken = try await user.getIDToken()
        var request = URLRequest(url: URL(string: path, relativeTo: apiBase)!)
        request.httpMethod = method
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AccountError.server(message ?? "Account request failed")
        }
        return data
    }

    private static func verified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let value): return value
        case .unverified(_, let error): throw error
        }
    }

    enum AccountError: LocalizedError {
        case signInRequired, unknownProduct, productUnavailable, pending, unknownResult, invalidServerResponse
        case server(String)
        var errorDescription: String? {
            switch self {
            case .signInRequired: return "Sign in to your WonderLang account first."
            case .unknownProduct: return "Unknown WonderLang product."
            case .productUnavailable: return "This product is unavailable in the App Store."
            case .pending: return "The App Store payment is pending."
            case .unknownResult: return "The App Store returned an unknown purchase result."
            case .invalidServerResponse: return "The account server returned invalid data."
            case .server(let message): return message
            }
        }
    }
}
