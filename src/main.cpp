#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "vulkan/renderer/app/app.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::App app{};

    try {
        app.run();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
