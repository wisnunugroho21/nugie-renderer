#include "app.hpp"

#include "../render/render_system.hpp"
#include "../render/basic/basic_render_system.hpp"

namespace nugie {
    Application::Application() {
        std::vector<RenderSystem*> renderSystems;
        renderSystems.emplace_back(new BasicRenderSystem());

        this->device = std::make_unique<Device>();
        this->renderers = std::make_unique<Renderer>(renderSystems);
    }

    void Application::run() {
        this->device->initialize("Nugie Renderer", 640, 480);

        this->renderers->initialize(this->device.get());

        while (this->device->isRunning()) {
            this->device->poolEvents();
            this->renderers->render(this->device.get());
        }

        this->renderers->destroy();
    }
}