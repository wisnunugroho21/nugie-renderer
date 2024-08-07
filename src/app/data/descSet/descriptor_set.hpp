#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

#include <memory>
#include <unordered_map>

namespace NugieApp {
    struct DescriptorSetBinding {
        uint32_t descCount = 1u;
        VkDescriptorType descSetType;
        VkShaderStageFlags shaderStage;
    };

    class DescriptorSet {
    public:
        class Builder {
        public:
            Builder(NugieVulkan::Device *device, NugieVulkan::DescriptorPool *descriptorPool, uint32_t descSetCount);

            Builder &addBuffer(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                               VkDescriptorBufferInfo bufferInfo);

            Builder &addBuffer(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                               const std::vector<VkDescriptorBufferInfo> &bufferInfos);

            Builder &addImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                              VkDescriptorImageInfo imageInfo);

            Builder &addImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                              const std::vector<VkDescriptorImageInfo> &imageInfos);

            Builder &addManyImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                                  const std::vector<VkDescriptorImageInfo> &imageInfos);

            Builder &addManyImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage,
                                  const std::vector<std::vector<VkDescriptorImageInfo>> &imageInfos);

            DescriptorSet *build();

        private:
            NugieVulkan::Device *device = nullptr;
            NugieVulkan::DescriptorPool *descriptorPool = nullptr;
            uint32_t descSetCount;

            std::unordered_map<uint32_t, DescriptorSetBinding> descriptorSetBindings;

            std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos;
            std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos;
        };

        class Overwriter {
        public:
            Overwriter(uint32_t descSetCount);

            Overwriter &addBuffer(uint32_t binding, VkDescriptorBufferInfo bufferInfo);

            Overwriter &addBuffer(uint32_t binding, const std::vector<VkDescriptorBufferInfo> &bufferInfos);

            Overwriter &addImage(uint32_t binding, VkDescriptorImageInfo imageInfo);

            Overwriter &addImage(uint32_t binding, const std::vector<VkDescriptorImageInfo> &imageInfos);

            Overwriter &addManyImage(uint32_t binding, const std::vector<VkDescriptorImageInfo> &imageInfos);

            Overwriter &
            addManyImage(uint32_t binding, const std::vector<std::vector<VkDescriptorImageInfo>> &imageInfos);

            void overwrite(DescriptorSet *descriptorSet);

        private:
            uint32_t descSetCount;

            std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos;
            std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos;
        };

        DescriptorSet(NugieVulkan::Device *device, NugieVulkan::DescriptorPool *descriptorPool, uint32_t descSetCount,
                      const std::unordered_map<uint32_t, DescriptorSetBinding> &descriptorSetBindings,
                      const std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> &descriptorBufferInfos,
                      const std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> &descriptorImageInfos);

        ~DescriptorSet();

        VkDescriptorSet getDescriptorSets(uint32_t descSetIndex) const { return this->descriptorSets[descSetIndex]; }

        NugieVulkan::DescriptorSetLayout *getDescSetLayout() const { return this->descSetLayout; }

        void overwrite(std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos,
                       std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos);

    private:
        NugieVulkan::Device *device = nullptr;
        NugieVulkan::DescriptorPool *descriptorPool = nullptr;
        uint32_t descSetCount;

        NugieVulkan::DescriptorSetLayout *descSetLayout = nullptr;
        std::vector<VkDescriptorSet> descriptorSets;

        void createDescriptorLayout(const std::unordered_map<uint32_t, DescriptorSetBinding> &descriptorSetBindings);

        void
        createDescriptorSet(std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos,
                            std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos);
    };

}