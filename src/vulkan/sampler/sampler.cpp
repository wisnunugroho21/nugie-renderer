#include "sampler.hpp"

#include <stb_image.h>

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

#include "../buffer/buffer.hpp"
#include "../command/command_buffer.hpp"

namespace NugieVulkan {
    Sampler::Sampler(Device *device, VkFilter filterMode, VkSamplerAddressMode addressMode,
                     VkBool32 anisotropyEnable, VkBorderColor borderColor, VkCompareOp compareOp,
                     VkSamplerMipmapMode mipmapMode, float maxLod)
                     : device{device}
    {
        this->createSampler(filterMode, addressMode, anisotropyEnable, borderColor, compareOp, mipmapMode, maxLod);
    }

    Sampler::~Sampler() {
        vkDestroySampler(this->device->getLogicalDevice(), this->sampler, nullptr);
    }

    void Sampler::createSampler(VkFilter filterMode, VkSamplerAddressMode addressMode, VkBool32 anisotropyEnable,
                                VkBorderColor borderColor, VkCompareOp compareOp, VkSamplerMipmapMode mipmapMode, 
                                float maxLod) 
    {
        VkSamplerCreateInfo samplerInfo{};
        samplerInfo.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;

        samplerInfo.magFilter = filterMode;
        samplerInfo.minFilter = filterMode;

        samplerInfo.addressModeU = addressMode;
        samplerInfo.addressModeV = addressMode;
        samplerInfo.addressModeW = addressMode;

        samplerInfo.anisotropyEnable = anisotropyEnable;
        samplerInfo.maxAnisotropy = anisotropyEnable ? this->device->getProperties().limits.maxSamplerAnisotropy : 1.0f;

        samplerInfo.borderColor = borderColor;
        samplerInfo.unnormalizedCoordinates = VK_FALSE;

        samplerInfo.compareEnable = compareOp == VK_COMPARE_OP_NEVER ? VK_FALSE : VK_TRUE;
        samplerInfo.compareOp = compareOp;

        samplerInfo.mipmapMode = mipmapMode;
        samplerInfo.minLod = 0.0f; // Optional
        samplerInfo.maxLod = maxLod;
        samplerInfo.mipLodBias = 0.0f; // Optional

        if (vkCreateSampler(this->device->getLogicalDevice(), &samplerInfo, nullptr, &this->sampler) != VK_SUCCESS) {
            throw std::runtime_error("failed to create texture sampler!");
        }
    }

    VkDescriptorImageInfo Sampler::getDescriptorInfo(Image *image, VkImageLayout desiredImageLayout) const {
        VkDescriptorImageInfo imageInfo{};
        imageInfo.imageLayout = desiredImageLayout;
        imageInfo.imageView = image->getImageView();
        imageInfo.sampler = this->sampler;

        return imageInfo;
    }
} // namespace NugieVulkan
