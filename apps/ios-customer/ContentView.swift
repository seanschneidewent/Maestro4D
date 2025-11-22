import SwiftUI

struct ContentView: View {
    let greeting = "Welcome to Swift!"
    let now = Date()
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Hello, World!")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text(greeting)
                .font(.title2)
                .foregroundStyle(.secondary)
            
            Text("Current time: \(now.formatted(date: .abbreviated, time: .standard))")
                .font(.body)
                .foregroundStyle(.tertiary)
        }
        .padding()
    }
}

#Preview("iPad") {
    ContentView()
        .previewDevice(PreviewDevice(rawValue: "iPad Pro (12.9-inch) (6th generation)"))
}

#Preview("iPad Air") {
    ContentView()
        .previewDevice(PreviewDevice(rawValue: "iPad Air (5th generation)"))
}
