#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "vulkan/renderer/renderer/renderer.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::VulkanRenderer vulkanRenderer{};

    try {
        vulkanRenderer.run();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
