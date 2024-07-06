#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "app/app/path_tracing_app.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::PathTracingApp app{};

    try {
        app.run();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
