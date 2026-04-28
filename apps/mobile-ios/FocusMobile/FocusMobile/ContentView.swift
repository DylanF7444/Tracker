import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = FocusViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    Text("Sync: \(viewModel.syncStatus)")
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.green.opacity(0.2))
                        .clipShape(Capsule())
                    Spacer()
                    Button("Sync now") {
                        Task { await viewModel.syncNow() }
                    }
                }

                HStack {
                    Button("Tag deep work") {
                        viewModel.addTag("deep work")
                    }
                    Button("Tag break") {
                        viewModel.addTag("break")
                    }
                    Button("Ingest sample usage") {
                        viewModel.ingestSampleForegroundUsage()
                    }
                }
                .buttonStyle(.borderedProminent)

                List(viewModel.sessions) { session in
                    VStack(alignment: .leading) {
                        Text(session.appName).font(.headline)
                        Text("\(session.startTs) → \(session.endTs)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(session.source) · \(session.category) · \(session.tag)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding()
            .navigationTitle("Focus iOS")
        }
    }
}
