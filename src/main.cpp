#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "app/app/terrain_app.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::TerrainApp app{};

    try {
        app.singleThreadRun();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
