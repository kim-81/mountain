import SwiftUI

@main
struct SeoulTrailApp: App {
    var body: some Scene { WindowGroup { TrailView().ignoresSafeArea(.container, edges: .bottom) } }
}
