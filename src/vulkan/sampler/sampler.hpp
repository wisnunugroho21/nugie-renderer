#pragma once

#include <vulkan/vulkan.h>
#include <stdexcept>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"
#include "../image/image.hpp"

#include <memory>

namespace NugieVulkan {
    class Sampler {
    public:
        Sampler(Device *device, VkFilter filterMode, VkSamplerAddressMode addressMode,
                VkBool32 anisotropyEnable, VkBorderColor borderColor, VkCompareOp compareOp,
                VkSamplerMipmapMode mipmapMode, float maxLod);

        ~Sampler();

        VkDescriptorImageInfo getDescriptorInfo(
                Image *image,
                VkImageLayout desiredImageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) const;

    private:
        Device *device = nullptr;
        VkSampler sampler;

        void createSampler(VkFilter filterMode, VkSamplerAddressMode addressMode, VkBool32 anisotropyEnable,
                           VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode, float maxLod);
    };


} // namespace NugieVulkan
