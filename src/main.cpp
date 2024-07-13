#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "app/app/mesh_shading_app.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::MeshShadingApp app{};

    try {
        app.run();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
