#include <cstdlib>
#include <iostream>
#include <stdexcept>

#include "app/app/app.hpp"

int main(int argc, char const *argv[])
{
    NugieApp::App app{};

    try {
        app.singleThreadRun();
    } catch(const std::exception &e) {
        std::cerr << e.what() << "\n";
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
